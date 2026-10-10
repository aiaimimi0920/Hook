// WGC may emit only dirty frames. Silence after a valid image is not device loss;
// source closure, identity and geometry remain checked by the capture owner.
pub(super) fn requires_idle_recovery(has_encoded_frame: bool, callback_errors: u64) -> bool {
    !has_encoded_frame || callback_errors != 0
}

#[cfg(test)]
mod tests {
    use super::requires_idle_recovery;

    #[test]
    fn static_content_keeps_its_existing_epoch_and_latest_image() {
        assert!(!requires_idle_recovery(true, 0));
    }

    #[test]
    fn initial_frame_timeout_still_recovers() {
        assert!(requires_idle_recovery(false, 0));
    }

    #[test]
    fn callback_failure_still_recovers_after_a_valid_image() {
        assert!(requires_idle_recovery(true, 1));
        assert!(requires_idle_recovery(true, u64::MAX));
    }

    #[test]
    fn callback_failure_before_first_image_still_recovers() {
        assert!(requires_idle_recovery(false, 1));
    }
}
