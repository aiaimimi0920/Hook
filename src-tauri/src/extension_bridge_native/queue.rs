//! Bounded WebView transport envelopes, separate from extension resource authorization.
use std::collections::VecDeque;

pub(super) const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_ITEMS: usize = 128;

#[derive(Default)]
pub(super) struct TextQueue {
    items: VecDeque<String>,
    bytes: usize,
}

impl TextQueue {
    pub(super) fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub(super) fn push(&mut self, text: String) -> Result<(), String> {
        if self.items.len() >= MAX_ITEMS || text.len() > MAX_BYTES.saturating_sub(self.bytes) {
            return Err("Extension bridge queue limit reached".into());
        }
        self.bytes += text.len();
        self.items.push_back(text);
        Ok(())
    }

    pub(super) fn pop(&mut self) -> Option<String> {
        let text = self.items.pop_front()?;
        self.bytes -= text.len();
        Some(text)
    }
}

pub(super) fn validate_message(text: &str) -> Result<(), String> {
    if text.len() > MAX_BYTES {
        return Err("Extension bridge message limit reached".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|_| "Invalid extension bridge message")?;
    let allowed = matches!(
        value.get("method").and_then(serde_json::Value::as_str),
        Some(
            "loom.hook.handshake"
                | "loom.extension.handshake"
                | "loom.extension.command.authorize"
                | "loom.extension.command.invoke"
        )
    );
    if !allowed
        || !value
            .get("params")
            .is_some_and(serde_json::Value::is_object)
    {
        return Err("Extension bridge method is not allowed".into());
    }
    Ok(())
}
