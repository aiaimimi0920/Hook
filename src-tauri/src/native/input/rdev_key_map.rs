// Maps rdev keyboard events to Windows virtual-key codes.

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RdevAppScopedShortcut {
    Escape,
    Delete,
}

#[cfg(target_os = "windows")]
fn rdev_key_to_vk_code(key: rdev::Key) -> Option<u32> {
    use rdev::Key;
    match key {
        Key::Escape => Some(0x1B),
        Key::Delete => Some(0x2E),
        Key::Backspace => Some(0x08),
        Key::Tab => Some(0x09),
        Key::Space => Some(0x20),
        Key::F1 => Some(0x70),
        Key::F2 => Some(0x71),
        Key::F3 => Some(0x72),
        Key::F4 => Some(0x73),
        Key::F5 => Some(0x74),
        Key::F6 => Some(0x75),
        Key::F7 => Some(0x76),
        Key::F8 => Some(0x77),
        Key::F9 => Some(0x78),
        Key::F10 => Some(0x79),
        Key::F11 => Some(0x7A),
        Key::F12 => Some(0x7B),
        Key::Num0 => Some(b'0' as u32),
        Key::Num1 => Some(b'1' as u32),
        Key::Num2 => Some(b'2' as u32),
        Key::Num3 => Some(b'3' as u32),
        Key::Num4 => Some(b'4' as u32),
        Key::Num5 => Some(b'5' as u32),
        Key::Num6 => Some(b'6' as u32),
        Key::Num7 => Some(b'7' as u32),
        Key::Num8 => Some(b'8' as u32),
        Key::Num9 => Some(b'9' as u32),
        Key::KeyA => Some(b'A' as u32),
        Key::KeyB => Some(b'B' as u32),
        Key::KeyC => Some(b'C' as u32),
        Key::KeyD => Some(b'D' as u32),
        Key::KeyE => Some(b'E' as u32),
        Key::KeyF => Some(b'F' as u32),
        Key::KeyG => Some(b'G' as u32),
        Key::KeyH => Some(b'H' as u32),
        Key::KeyI => Some(b'I' as u32),
        Key::KeyJ => Some(b'J' as u32),
        Key::KeyK => Some(b'K' as u32),
        Key::KeyL => Some(b'L' as u32),
        Key::KeyM => Some(b'M' as u32),
        Key::KeyN => Some(b'N' as u32),
        Key::KeyO => Some(b'O' as u32),
        Key::KeyP => Some(b'P' as u32),
        Key::KeyQ => Some(b'Q' as u32),
        Key::KeyR => Some(b'R' as u32),
        Key::KeyS => Some(b'S' as u32),
        Key::KeyT => Some(b'T' as u32),
        Key::KeyU => Some(b'U' as u32),
        Key::KeyV => Some(b'V' as u32),
        Key::KeyW => Some(b'W' as u32),
        Key::KeyX => Some(b'X' as u32),
        Key::KeyY => Some(b'Y' as u32),
        Key::KeyZ => Some(b'Z' as u32),
        _ => None,
    }
}
