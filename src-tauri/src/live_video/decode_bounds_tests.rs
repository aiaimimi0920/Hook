use super::*;

struct Writer(Vec<bool>);
impl Writer {
    fn bits(&mut self, value: u32, count: u32) {
        for shift in (0..count).rev() {
            self.0.push(value & (1 << shift) != 0);
        }
    }
    fn ue(&mut self, value: u32) {
        let value = value + 1;
        let bits = 32 - value.leading_zeros();
        self.bits(0, bits - 1);
        self.bits(value, bits);
    }
    fn finish(mut self, header: u8) -> Vec<u8> {
        self.0.push(true);
        while self.0.len() % 8 != 0 {
            self.0.push(false);
        }
        let mut bytes = vec![0, 0, 1, header];
        for chunk in self.0.chunks(8) {
            bytes.push(
                chunk
                    .iter()
                    .fold(0, |byte, bit| (byte << 1) | u8::from(*bit)),
            );
        }
        bytes
    }
}

// Parameter syntax fixture only; not a decodable compressed picture.
fn fixture(width_mbs: u32, refs: u32, profile: u32) -> Vec<u8> {
    fixture_color(width_mbs, refs, profile, None)
}

fn fixture_color(width_mbs: u32, refs: u32, profile: u32, transfer: Option<u32>) -> Vec<u8> {
    fixture_vui(
        width_mbs,
        refs,
        profile,
        transfer.map(|transfer| (1, transfer, 1, false)),
    )
}

fn fixture_vui(
    width_mbs: u32,
    refs: u32,
    profile: u32,
    color: Option<(u32, u32, u32, bool)>,
) -> Vec<u8> {
    let mut bits = Writer(Vec::new());
    bits.bits(profile, 8);
    bits.bits(0, 8);
    bits.bits(31, 8);
    bits.ue(0);
    bits.ue(0);
    bits.ue(2);
    bits.ue(refs);
    bits.bits(0, 1);
    bits.ue(width_mbs - 1);
    bits.ue(14);
    bits.bits(1, 1);
    bits.bits(1, 1);
    bits.bits(0, 1);
    bits.bits(u32::from(color.is_some()), 1);
    if let Some((primaries, transfer, matrix, full_range)) = color {
        bits.bits(0, 1);
        bits.bits(0, 1); // aspect ratio / overscan absent
        bits.bits(1, 1);
        bits.bits(5, 3);
        bits.bits(u32::from(full_range), 1);
        bits.bits(1, 1);
        bits.bits(primaries, 8);
        bits.bits(transfer, 8);
        bits.bits(matrix, 8);
        bits.bits(0, 6); // chroma location, timing, both HRDs, pic struct, restriction absent
    }
    let mut bytes = bits.finish(0x67);
    let mut pps = Writer(Vec::new());
    pps.ue(0);
    pps.ue(0);
    pps.bits(0, 2);
    pps.ue(0);
    pps.ue(0);
    pps.ue(0);
    bytes.extend(pps.finish(0x68));
    bytes.extend([0, 0, 1, 0x65, 0x88]);
    bytes
}

#[test]
fn decoder_checks_actual_sps_dimensions_and_reference_budget_before_mf() {
    let format = Format::new(320, 240, 30).unwrap();
    assert!(validate(&fixture(20, 1, 66), format, true).is_ok());
    for bytes in [
        fixture(21, 1, 66),
        fixture(262144, 1, 66),
        fixture(20, 5, 66),
        fixture(20, 1, 100),
    ] {
        assert!(validate(&bytes, format, true).is_err());
    }
    assert!(validate(&fixture(20, 1, 66), format, false).is_err());
    assert!(validate(&[0, 0, 1, 0x41, 0x80], format, false).is_ok());
    assert!(validate(&[0, 0, 1, 0x65, 0x80], format, true).is_err());
}

#[test]
fn decoder_rejects_truncated_parameters_and_unbounded_golomb() {
    let format = Format::new(320, 240, 30).unwrap();
    let bytes = fixture(20, 1, 66);
    for length in 0..bytes.len() {
        assert!(validate(&bytes[..length], format, true).is_err());
    }
    assert!(Bits::rbsp(&[0, 0, 3, 4]).is_err());
    assert!(Bits::rbsp(&[0, 0, 3]).is_err());
    assert!(Bits::rbsp(&[0; 1025]).is_err());
    assert!(Bits::rbsp(&[0; 8]).unwrap().ue().is_err());
}

#[test]
fn encoder_normalizes_only_reserved_transfer_without_relaxing_decoder() {
    let format = Format::new(320, 240, 30).unwrap();
    let old = fixture_color(20, 1, 66, Some(0));
    assert!(validate(&old, format, true).is_err());
    let normalized = normalize_encoder_transfer(&old, format).unwrap();
    validate(&normalized, format, true).unwrap();
    assert_eq!(
        annex_b::units(&old).unwrap()[1..],
        annex_b::units(&normalized).unwrap()[1..]
    );
    assert_eq!(
        normalize_encoder_transfer(&normalized, format).unwrap(),
        normalized
    );
    assert!(normalize_encoder_transfer(&fixture_color(20, 1, 66, Some(16)), format).is_err());
}

#[test]
fn decoder_color_defaults_are_explicit_and_conflicting_signals_are_rejected() {
    let format = Format::new(320, 240, 30).unwrap();
    for color in [None, Some((1, 13, 1, false)), Some((2, 2, 2, false))] {
        assert!(validate(&fixture_vui(20, 1, 66, color), format, true).is_ok());
    }
    for color in [
        (1, 13, 1, true),
        (1, 13, 6, false),
        (9, 16, 9, false),
        (1, 0, 1, false),
    ] {
        assert!(validate(&fixture_vui(20, 1, 66, Some(color)), format, true).is_err());
    }
}

#[test]
fn decoder_explicit_dpb_budget_covers_reference_count_and_stays_bounded() {
    for (buffering, accepted) in [(0, false), (1, true), (4, true), (5, false)] {
        let mut writer = Writer(Vec::new());
        writer.bits(0, 8);
        writer.bits(1, 1);
        writer.bits(0, 1);
        for _ in 0..5 {
            writer.ue(0);
        }
        writer.ue(buffering);
        let nal = writer.finish(0x67);
        let mut bits = Bits::rbsp(&nal[4..]).unwrap();
        assert_eq!(vui(&mut bits, 1, false).is_ok(), accepted);
    }
}
