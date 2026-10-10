use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;

fn redirect_fixture(status: u16) -> (String, TcpListener, std::thread::JoinHandle<()>) {
    let target = TcpListener::bind("127.0.0.1:0").unwrap();
    target.set_nonblocking(true).unwrap();
    let destination = target.local_addr().unwrap();
    let source = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", source.local_addr().unwrap());
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = source.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut buffer = [0; 4096];
        stream.read(&mut buffer).unwrap();
        write!(stream, "HTTP/1.1 {status} Redirect\r\nLocation: http://{destination}/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    });
    (origin, target, worker)
}

#[test]
fn loom_clients_never_follow_get_or_post_redirects() {
    let _guard = tests::TEST_GUARD.lock().unwrap();
    let runtime = tokio::runtime::Runtime::new().unwrap();
    for status in [301, 302, 303, 307, 308] {
        for method in [reqwest::Method::GET, reqwest::Method::POST] {
            for blocking in [false, true] {
                let (origin, target, worker) = redirect_fixture(status);
                let timeout = Some(Duration::from_secs(2));
                let observed = if blocking {
                    loom_blocking_client(&origin, timeout)
                        .unwrap()
                        .request(method.clone(), &origin)
                        .send()
                        .unwrap()
                        .status()
                } else {
                    runtime.block_on(async {
                        loom_client(&origin, timeout)
                            .unwrap()
                            .request(method.clone(), &origin)
                            .send()
                            .await
                            .unwrap()
                            .status()
                    })
                };
                assert_eq!(observed.as_u16(), status);
                assert_eq!(
                    target.accept().unwrap_err().kind(),
                    std::io::ErrorKind::WouldBlock
                );
                worker.join().unwrap();
            }
        }
    }
}
