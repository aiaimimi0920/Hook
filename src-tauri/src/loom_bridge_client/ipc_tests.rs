//! Real TLS/WS boundaries for the persistent IPC worker; no desktop or user data involved.
use super::*;
use crate::extension_bridge_native::TestSession;
use rustls::{ServerConfig, ServerConnection};
use std::{io::Write, net::TcpListener, thread};
use tungstenite::Message;

fn accept(
    listener: TcpListener,
    config: Arc<ServerConfig>,
) -> WebSocket<StreamOwned<ServerConnection, BridgeStream>> {
    let stream = BridgeStream::handshake(
        listener.accept().unwrap().0,
        Instant::now() + HANDSHAKE_LIMIT,
    )
    .unwrap();
    let tls = ServerConnection::new(config).unwrap();
    tungstenite::accept(StreamOwned::new(tls, stream)).unwrap()
}

fn wait_for(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !predicate() {
        assert!(
            Instant::now() < deadline,
            "bounded worker operation timed out"
        );
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn partial_tls_websocket_frames_survive_timeout_and_terminal_queue_drains() {
    let (listener, identity, config) = tests::fixture();
    let server = thread::spawn(move || {
        let mut socket = accept(listener, config);
        // Fragmented text across several client 100 ms read deadlines.
        socket
            .get_mut()
            .write_all(&[0x01, 3, b'a', b'b', b'c'])
            .unwrap();
        socket.get_mut().flush().unwrap();
        thread::sleep(Duration::from_millis(250));
        socket.send(Message::Ping(vec![42])).unwrap();
        socket
            .get_mut()
            .write_all(&[0x80, 3, b'd', b'e', b'f'])
            .unwrap();
        socket.get_mut().flush().unwrap();
        socket.send(Message::Text("second".into())).unwrap();
        socket.send(Message::Text("third".into())).unwrap();
        assert_eq!(socket.read().unwrap(), Message::Pong(vec![42]));
        socket.close(None).unwrap();
    });
    let session = TestSession::start_with(move || {
        connect_identity(&identity, Duration::from_millis(100)).map_err(|_| "connect failed".into())
    })
    .unwrap();
    server.join().unwrap();
    wait_for(|| session.finished());
    for (message, closed) in [("abcdef", false), ("second", false), ("third", true)] {
        let response = serde_json::to_value(session.poll().unwrap()).unwrap();
        assert_eq!(response["message"], message);
        assert_eq!(response["closed"], closed);
    }
}

#[test]
fn pong_flush_uses_a_fresh_budget_after_the_read_deadline_expires() {
    let (listener, identity, config) = tests::fixture();
    let server = thread::spawn(move || {
        let mut socket = accept(listener, config);
        socket.send(Message::Ping(vec![42])).unwrap();
        assert_eq!(socket.read().unwrap(), Message::Pong(vec![42]));
    });
    let mut socket = connect_identity(&identity, Duration::from_secs(1)).unwrap();
    assert_eq!(socket.read().unwrap(), Message::Ping(vec![42]));
    // Deterministically model descheduling after read succeeds, before its reply.
    socket.get_mut().sock.operation_deadline(Duration::ZERO);
    let result = flush_control_reply(&mut socket);
    drop(socket);
    let server_result = server.join();
    result.unwrap();
    server_result.unwrap();
}

#[test]
fn stopping_connected_ipc_interrupts_blocked_read_and_joins_before_returning() {
    let (listener, identity, config) = tests::fixture();
    let server = thread::spawn(move || {
        let mut socket = accept(listener, config);
        assert!(socket.read().is_err());
    });
    let session = TestSession::start_with(move || {
        connect_identity(&identity, Duration::from_millis(100)).map_err(|_| "connect failed".into())
    })
    .unwrap();
    wait_for(|| serde_json::to_value(session.poll().unwrap()).unwrap()["connected"] == true);
    thread::sleep(Duration::from_millis(350));
    assert_eq!(
        serde_json::to_value(session.poll().unwrap()).unwrap()["connected"],
        true
    );
    let started = Instant::now();
    drop(session);
    assert!(started.elapsed() < Duration::from_secs(2));
    server.join().unwrap();
}
