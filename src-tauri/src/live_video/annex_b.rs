//! 编码输出共用的有界 Annex-B 检查；不是完整解码器，像素正确性另行验证。
use anyhow::{ensure, Result};

#[derive(Debug, Default, serde::Serialize)]
pub struct Summary {
    pub idr: bool,
    pub delta: bool,
    pub sps: bool,
    pub pps: bool,
}

pub fn inspect(bytes: &[u8]) -> Result<Summary> {
    ensure!(
        !bytes.is_empty() && bytes.len() <= 1024 * 1024,
        "access unit size invalid"
    );
    let prefix = |at: usize| -> Option<usize> {
        if bytes.get(at..at + 4) == Some(&[0, 0, 0, 1]) {
            Some(4)
        } else if bytes.get(at..at + 3) == Some(&[0, 0, 1]) {
            Some(3)
        } else {
            None
        }
    };
    let mut summary = Summary::default();
    let mut cursor = 0;
    let mut count = 0;
    while cursor < bytes.len() {
        let size = prefix(cursor).ok_or_else(|| anyhow::anyhow!("Annex-B start code missing"))?;
        let begin = cursor + size;
        let end = (begin..bytes.len())
            .find(|&at| prefix(at).is_some())
            .unwrap_or(bytes.len());
        ensure!(end > begin, "empty NAL unit");
        ensure!(bytes[begin] & 0x80 == 0, "forbidden NAL bit");
        match bytes[begin] & 31 {
            1 => summary.delta = true,
            5 => summary.idr = true,
            7 => {
                ensure!(end - begin >= 4, "truncated SPS");
                summary.sps = true;
            }
            8 => summary.pps = true,
            6 | 9 | 10 | 11 | 12 => {}
            _ => anyhow::bail!("unsupported NAL type"),
        }
        count += 1;
        ensure!(count <= 256, "too many NAL units");
        cursor = end;
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifies_mixed_start_codes_and_keyframe_headers() {
        let result = inspect(&[
            0, 0, 0, 1, 0x67, 0x42, 0, 30, 0, 0, 1, 0x68, 1, 0, 0, 1, 0x65, 2,
        ])
        .unwrap();
        assert!(result.sps && result.pps && result.idr && !result.delta);
        assert!(inspect(&[0, 0, 1, 0x41, 1]).unwrap().delta);
    }
    #[test]
    fn rejects_truncation_invalid_headers_and_unbounded_input() {
        for bytes in [
            &[][..],
            &[0, 0, 1][..],
            &[1, 2, 3][..],
            &[0, 0, 1, 0xe5][..],
            &[0, 0, 1, 0x67][..],
        ] {
            assert!(inspect(bytes).is_err());
        }
        assert!(inspect(&vec![0; 1024 * 1024 + 1]).is_err());
        assert!(inspect(&[0, 0, 1, 9].repeat(257)).is_err());
    }
}
