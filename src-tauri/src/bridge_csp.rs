//! Grants the main WebView only its configured local bridge origin.
use std::collections::HashMap;
use tauri::utils::config::{Csp, CspDirectiveSources, SecurityConfig};

fn loopback_origin(endpoint: &str) -> Option<String> {
    if endpoint.len() > 2048 {
        return None;
    }
    let url = reqwest::Url::parse(endpoint.trim()).ok()?;
    if !matches!(url.scheme(), "ws" | "wss")
        || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port() == Some(0)
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

fn extend_connect_source(csp: &mut Option<Csp>, origin: &str) {
    let Some(policy) = csp.as_ref() else {
        return;
    };
    let mut directives: HashMap<String, CspDirectiveSources> = policy.clone().into();
    let Some(sources) = directives.get_mut("connect-src") else {
        return;
    };
    let existing: Vec<String> = sources.clone().into();
    if existing
        .iter()
        .any(|source| source == "'none'" || source == origin)
    {
        return;
    }
    sources.push(origin);
    *csp = Some(Csp::DirectiveMap(directives));
}

pub(crate) fn allow_configured_bridge(security: &mut SecurityConfig, endpoint: &str) {
    let Some(origin) = loopback_origin(endpoint) else {
        return;
    };
    // Preserve the static policy and explicit denials; never add port/host wildcards.
    extend_connect_source(&mut security.csp, &origin);
    extend_connect_source(&mut security.dev_csp, &origin);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn security() -> SecurityConfig {
        serde_json::from_str::<tauri::Config>(include_str!("../tauri.conf.json"))
            .unwrap()
            .app
            .security
    }

    fn directives(csp: &Option<Csp>) -> HashMap<String, CspDirectiveSources> {
        csp.clone().unwrap().into()
    }

    #[test]
    fn configured_port_is_added_without_changing_other_security_directives() {
        let mut security = security();
        let mut before = directives(&security.csp);
        let expected: Vec<String> = before.remove("connect-src").unwrap().into();
        allow_configured_bridge(&mut security, "ws://127.0.0.1:48766");
        let mut after = directives(&security.csp);
        let connections: Vec<String> = after.remove("connect-src").unwrap().into();
        assert_eq!(after, before);
        assert_eq!(
            connections,
            [expected, vec!["ws://127.0.0.1:48766".into()]].concat()
        );
        assert!(security.dev_csp.is_none());
    }

    #[test]
    fn explicit_dev_policy_and_repeated_configuration_keep_one_exact_source() {
        let mut security = security();
        security.dev_csp = Some(Csp::Policy("connect-src 'self'; script-src 'self'".into()));
        for _ in 0..2 {
            allow_configured_bridge(&mut security, "ws://localhost:48766/");
        }
        for csp in [&security.csp, &security.dev_csp] {
            let sources: Vec<String> = directives(csp).remove("connect-src").unwrap().into();
            assert_eq!(
                sources
                    .iter()
                    .filter(|source| *source == "ws://localhost:48766")
                    .count(),
                1
            );
            assert!(!sources.iter().any(|source| source.contains('*')));
        }
    }

    #[test]
    fn remote_hosts_and_non_origin_endpoints_cannot_widen_the_policy() {
        for endpoint in [
            "ws://192.168.15.130:48766",
            "wss://example.com",
            "ws://localhost.example.com",
            "http://127.0.0.1:48766",
            "file:///bridge",
            "ws://user:secret@localhost:48766",
            "ws://localhost:0",
            "ws://localhost:48766/bridge",
            "ws://localhost:48766?token=x",
            "ws://localhost:48766/#fragment",
            "ws://localhost:48766/; connect-src *",
        ] {
            let mut security = security();
            let before = security.csp.clone();
            allow_configured_bridge(&mut security, endpoint);
            assert_eq!(security.csp, before, "unexpected grant for {endpoint}");
        }
    }

    #[test]
    fn disabled_missing_and_explicitly_denied_policies_remain_unchanged() {
        for csp in [
            None,
            Some(Csp::Policy("default-src 'none'".into())),
            Some(Csp::Policy("connect-src 'none'".into())),
        ] {
            let mut security = security();
            security.csp = csp.clone();
            allow_configured_bridge(&mut security, "ws://127.0.0.1:48766");
            assert_eq!(security.csp, csp);
        }
    }

    #[test]
    fn secure_and_ipv6_loopback_origins_are_canonicalized() {
        assert_eq!(
            loopback_origin("wss://LOCALHOST:443/"),
            Some("wss://localhost".into())
        );
        assert_eq!(
            loopback_origin("ws://[::1]:48766/"),
            Some("ws://[::1]:48766".into())
        );
        assert_eq!(loopback_origin(&"x".repeat(2049)), None);
    }
}
