//! Decoder 前的 baseline SPS 分配预算；不相信网络头的尺寸，也不实现像素解码。
use super::{annex_b, Format};
use anyhow::{ensure, Context, Result};

pub(super) fn validate(bytes: &[u8], format: Format, keyframe: bool) -> Result<()> {
    let (mut sps, mut pps, mut idr, mut delta) = (false, false, false, false);
    for nal in annex_b::units(bytes)? {
        match nal[0] & 31 {
            7 => {
                ensure!(!idr && !delta, "late SPS");
                parse_sps(nal, format, false)?;
                sps = true;
            }
            8 => {
                ensure!(!idr && !delta && nal.len() >= 2, "late or empty PPS");
                let mut bits = Bits::rbsp(&nal[1..])?;
                ensure!(bits.ue()? <= 255 && bits.ue()? <= 31, "PPS identity bounds");
                ensure!(
                    bits.read(1)? == 0,
                    "CABAC is outside baseline decoder contract"
                );
                bits.read(1)?;
                ensure!(bits.ue()? == 0, "slice groups unsupported");
                ensure!(bits.ue()? <= 3 && bits.ue()? <= 3, "PPS reference budget");
                pps = true;
            }
            5 => {
                ensure!(
                    !delta && sps && pps && nal.len() > 1,
                    "IDR requires SPS/PPS"
                );
                idr = true;
            }
            1 => {
                ensure!(!idr && nal.len() > 1, "mixed or empty picture");
                delta = true;
            }
            6 | 9 | 10 | 11 | 12 => {}
            _ => anyhow::bail!("unsupported video NAL"),
        }
    }
    ensure!(
        keyframe == idr && (idr || delta) && !(delta && (sps || pps)),
        "video keyframe contract"
    );
    Ok(())
}

fn parse_sps(nal: &[u8], format: Format, normalize: bool) -> Result<Bits> {
    ensure!(nal.len() <= 1024, "SPS size budget");
    let mut bits = Bits::rbsp(&nal[1..])?;
    ensure!(bits.read(8)? == 66, "decoder requires baseline 8-bit 4:2:0");
    ensure!(bits.read(8)? & 3 == 0, "SPS reserved bits");
    ensure!(bits.read(8)? <= 52, "SPS level budget");
    ensure!(
        bits.ue()? <= 31 && bits.ue()? <= 12,
        "SPS identity/frame number bounds"
    );
    match bits.ue()? {
        0 => ensure!(bits.ue()? <= 12, "POC width budget"),
        2 => {}
        _ => anyhow::bail!("POC mode unsupported"),
    }
    let refs = bits.ue()?;
    ensure!(refs <= 4, "decoder reference picture count budget");
    bits.read(1)?;
    let width = bits
        .ue()?
        .checked_add(1)
        .and_then(|v| v.checked_mul(16))
        .context("coded width overflow")?;
    let height = bits
        .ue()?
        .checked_add(1)
        .and_then(|v| v.checked_mul(16))
        .context("coded height overflow")?;
    ensure!(
        width <= 4096 && height <= 4096 && u64::from(width) * u64::from(height) <= 8_294_400,
        "coded surface budget"
    );
    ensure!(bits.read(1)? == 1, "interlaced video unsupported");
    bits.read(1)?;
    let (mut crop_x, mut crop_y) = (0, 0);
    if bits.read(1)? != 0 {
        crop_x = bits
            .ue()?
            .checked_add(bits.ue()?)
            .and_then(|v| v.checked_mul(2))
            .context("horizontal crop overflow")?;
        crop_y = bits
            .ue()?
            .checked_add(bits.ue()?)
            .and_then(|v| v.checked_mul(2))
            .context("vertical crop overflow")?;
    }
    ensure!(
        width.checked_sub(crop_x) == Some(format.width)
            && height.checked_sub(crop_y) == Some(format.height),
        "SPS/wire dimensions mismatch"
    );
    // Missing/unspecified VUI uses the fixed C1 sRGB / BT709 limited-range profile.
    if bits.read(1)? != 0 {
        vui(&mut bits, refs, normalize)?;
    }
    Ok(bits)
}

fn vui(bits: &mut Bits, refs: u32, normalize: bool) -> Result<()> {
    if bits.read(1)? != 0 && bits.read(8)? == 255 {
        bits.read(16)?;
        bits.read(16)?;
    }
    if bits.read(1)? != 0 {
        bits.read(1)?;
    }
    if bits.read(1)? != 0 {
        bits.read(3)?;
        ensure!(bits.read(1)? == 0, "full-range YUV unsupported");
        if bits.read(1)? != 0 {
            let primaries = bits.read(8)?;
            let transfer_at = bits.at;
            let mut transfer = bits.read(8)?;
            // Some hardware MFTs ignore MF_MT_TRANSFER_FUNCTION and emit reserved zero.
            // Only our known sRGB encoder output may be normalized; network decode stays strict.
            if normalize && transfer == 0 {
                transfer = 13;
                for bit in 0..8 {
                    let at = transfer_at + bit;
                    let mask = 1 << (7 - at % 8);
                    bits.bytes[at / 8] =
                        (bits.bytes[at / 8] & !mask) | (((13 >> (7 - bit)) & 1) << (7 - at % 8));
                }
            }
            let matrix = bits.read(8)?;
            ensure!(
                [1, 2].contains(&primaries)
                    && [2, 13].contains(&transfer)
                    && [1, 2].contains(&matrix),
                "video colorimetry outside BT709 contract: primaries={primaries} transfer={transfer} matrix={matrix}"
            );
        }
    }
    if bits.read(1)? != 0 {
        ensure!(bits.ue()? <= 5 && bits.ue()? <= 5, "chroma location bounds");
    }
    if bits.read(1)? != 0 {
        ensure!(
            bits.read(32)? > 0 && bits.read(32)? > 0,
            "VUI timing invalid"
        );
        bits.read(1)?;
    }
    let nal_hrd = bits.read(1)? != 0;
    if nal_hrd {
        hrd(bits)?;
    }
    let vcl_hrd = bits.read(1)? != 0;
    if vcl_hrd {
        hrd(bits)?;
    }
    if nal_hrd || vcl_hrd {
        bits.read(1)?;
    }
    bits.read(1)?;
    if bits.read(1)? != 0 {
        bits.read(1)?;
        for _ in 0..4 {
            ensure!(bits.ue()? <= 16, "VUI denominator/vector budget");
        }
        let reorder = bits.ue()?;
        let buffering = bits.ue()?;
        ensure!(
            reorder <= refs && buffering >= refs && buffering <= 4,
            "VUI decoded picture buffer budget"
        );
    }
    Ok(())
}

fn hrd(bits: &mut Bits) -> Result<()> {
    let count = bits.ue()?;
    ensure!(count <= 31, "HRD count budget");
    bits.read(8)?;
    for _ in 0..=count {
        bits.ue()?;
        bits.ue()?;
        bits.read(1)?;
    }
    bits.read(20)?;
    Ok(())
}

struct Bits {
    bytes: Vec<u8>,
    at: usize,
}

pub(super) fn normalize_encoder_transfer(bytes: &[u8], format: Format) -> Result<Vec<u8>> {
    let mut output = Vec::with_capacity(bytes.len());
    for nal in annex_b::units(bytes)? {
        output.extend_from_slice(&[0, 0, 0, 1]);
        if nal[0] & 31 != 7 {
            output.extend_from_slice(nal);
            continue;
        }
        let rbsp = parse_sps(nal, format, true)?;
        output.push(nal[0]);
        let mut zeros = 0;
        for byte in rbsp.bytes {
            if zeros >= 2 && byte <= 3 {
                output.push(3);
                zeros = 0;
            }
            output.push(byte);
            zeros = if byte == 0 { zeros + 1 } else { 0 };
        }
    }
    ensure!(output.len() <= 1024 * 1024, "normalized access unit budget");
    Ok(output)
}
impl Bits {
    fn rbsp(bytes: &[u8]) -> Result<Self> {
        ensure!(bytes.len() <= 1024, "parameter set size budget");
        let mut out = Vec::with_capacity(bytes.len());
        let mut zeros = 0;
        for (index, &byte) in bytes.iter().enumerate() {
            if zeros >= 2 && byte == 3 {
                ensure!(
                    bytes.get(index + 1).is_some_and(|next| *next <= 3),
                    "invalid emulation prevention"
                );
                zeros = 0;
                continue;
            }
            out.push(byte);
            zeros = if byte == 0 { zeros + 1 } else { 0 };
        }
        Ok(Self { bytes: out, at: 0 })
    }
    fn read(&mut self, count: usize) -> Result<u32> {
        ensure!(
            count <= 32 && self.at + count <= self.bytes.len() * 8,
            "truncated video parameter set"
        );
        let mut value = 0;
        for _ in 0..count {
            value = (value << 1) | u32::from((self.bytes[self.at / 8] >> (7 - self.at % 8)) & 1);
            self.at += 1;
        }
        Ok(value)
    }
    fn ue(&mut self) -> Result<u32> {
        let mut zeros = 0;
        while self.read(1)? == 0 {
            zeros += 1;
            ensure!(zeros <= 30, "Exp-Golomb budget");
        }
        Ok((1_u32 << zeros) - 1 + self.read(zeros)?)
    }
}

#[cfg(test)]
#[path = "decode_bounds_tests.rs"]
mod tests;
