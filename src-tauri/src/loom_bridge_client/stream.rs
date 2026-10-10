use std::{
    io::{self, Read, Write},
    net::TcpStream,
    time::{Duration, Instant},
};

/// Bounds the whole handshake, not merely each individual TLS record read.
pub(crate) struct BridgeStream {
    socket: TcpStream,
    deadline: Option<Instant>,
}

impl BridgeStream {
    pub(super) fn handshake(socket: TcpStream, deadline: Instant) -> io::Result<Self> {
        socket.set_nonblocking(false)?;
        socket.set_nodelay(true)?;
        Ok(Self {
            socket,
            deadline: Some(deadline),
        })
    }

    pub(super) fn application(&mut self, read_timeout: Duration) -> io::Result<()> {
        self.socket.set_read_timeout(Some(read_timeout))?;
        self.socket
            .set_write_timeout(Some(Duration::from_secs(5)))?;
        self.deadline = None;
        Ok(())
    }

    pub(crate) fn interrupt_handle(&self) -> io::Result<TcpStream> {
        self.socket.try_clone()
    }

    pub(crate) fn operation_deadline(&mut self, timeout: Duration) {
        self.deadline = Some(Instant::now() + timeout);
    }

    fn before_io(&self) -> io::Result<()> {
        if let Some(deadline) = self.deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(io::ErrorKind::TimedOut.into());
            }
            self.socket.set_read_timeout(Some(remaining))?;
            self.socket.set_write_timeout(Some(remaining))?;
        }
        Ok(())
    }
}

impl Read for BridgeStream {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.before_io()?;
        self.socket.read(bytes)
    }
}
impl Write for BridgeStream {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.before_io()?;
        self.socket.write(bytes)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.before_io()?;
        self.socket.flush()
    }
}
