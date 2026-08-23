use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock, RwLock};
use std::time::Duration;

use reqwest::{Client, ClientBuilder, Proxy, Url};
use serde::Deserialize;

/// Deliberately does not implement `Default`. The only sensible default would be `System`,
/// and a default is exactly what must never be reachable by accident: every place that has to
/// cope with a missing or unreadable setting has to state what it does instead, because
/// silently choosing `System` re-enables a proxy the user may have turned off.
#[derive(Clone, Debug, Eq, PartialEq)]
enum RuntimeProxy {
    System,
    Disabled,
    Custom(String),
}

#[derive(Deserialize)]
struct LoomSettings {
    #[serde(default)]
    network: LoomNetworkSettings,
}

#[derive(Default, Deserialize)]
struct LoomNetworkSettings {
    #[serde(default)]
    hook: LoomProxySettings,
}

#[derive(Default, Deserialize)]
struct LoomProxySettings {
    #[serde(default)]
    mode: String,
    #[serde(default)]
    protocol: String,
    #[serde(default)]
    address: String,
}

static RUNTIME_PROXY: OnceLock<RwLock<RuntimeProxy>> = OnceLock::new();

fn proxy_store() -> &'static RwLock<RuntimeProxy> {
    RUNTIME_PROXY.get_or_init(|| RwLock::new(RuntimeProxy::System))
}

/// Reads the proxy setting, surviving a poisoned lock without changing what the user chose.
///
/// A lock is poisoned only because some thread panicked while holding it, which says nothing
/// about the setting itself. Falling back to a default here would hand back `System` and
/// silently re-enable the proxy for a user who explicitly disabled it — fail-open on a privacy
/// setting, triggered by an unrelated bug. The stored value cannot be half-written: the only
/// write is a single whole-value assignment, so it is either the old setting or the new one.
/// So it is recovered as-is, and the poison is cleared so that one panic does not leave every
/// later read and every later settings change degraded.
fn runtime_proxy() -> RuntimeProxy {
    match proxy_store().read() {
        Ok(proxy) => proxy.clone(),
        Err(poisoned) => {
            let proxy = poisoned.into_inner().clone();
            proxy_store().clear_poison();
            // The value itself is never logged: a custom proxy address may carry credentials.
            eprintln!("Hook proxy setting lock was poisoned by an earlier panic; kept the configured setting");
            proxy
        }
    }
}

/// Bumped whenever the proxy setting changes, so cached clients built under the old
/// setting are never handed out again.
static PROXY_GENERATION: AtomicU64 = AtomicU64::new(0);

/// A cached client is reused for every endpoint that resolves to the same proxy decision,
/// which is what `reqwest` is designed for: one long-lived `Client` owning one connection
/// pool, cloned per request. Only the inputs that change how the client is *built* belong
/// in the key — `reqwest` already pools connections per host internally, so the endpoint
/// itself does not.
#[derive(Clone, Eq, Hash, PartialEq)]
struct ClientKey {
    loopback: bool,
    timeout_millis: Option<u64>,
    flavor: &'static str,
}

#[derive(Default)]
struct ClientCache {
    generation: u64,
    clients: HashMap<ClientKey, Client>,
}

static CLIENT_CACHE: OnceLock<Mutex<ClientCache>> = OnceLock::new();

/// Part of the key is a timeout that comes from a capability manifest, so a file that varies
/// its `timeoutMs` per call could otherwise grow the map without bound. Every real call site
/// uses one of a handful of constant timeouts, so passing this cap means something is
/// generating keys rather than reusing them, and starting over is better than leaking.
const MAX_CACHED_CLIENTS: usize = 32;

fn client_cache() -> &'static Mutex<ClientCache> {
    CLIENT_CACHE.get_or_init(|| Mutex::new(ClientCache::default()))
}

/// Locks the client cache, surviving a poisoned mutex.
///
/// Skipping the cache on poison instead would mean one panic anywhere disables client reuse for
/// the rest of the process — and, worse, leaves `apply_loom_settings` unable to drop the clients
/// built for the old proxy, so a proxy change would stop taking effect. Unlike the proxy
/// setting, the map is not trusted after a panic: it is emptied, which costs one rebuild per key
/// and cannot serve anything stale.
fn lock_client_cache() -> MutexGuard<'static, ClientCache> {
    match client_cache().lock() {
        Ok(cache) => cache,
        Err(poisoned) => {
            client_cache().clear_poison();
            let mut cache = poisoned.into_inner();
            cache.clients.clear();
            eprintln!("Hook shared HTTP client cache was poisoned by an earlier panic; emptied it");
            cache
        }
    }
}

pub fn apply_loom_settings(settings: &serde_json::Value) -> Result<(), String> {
    let settings: LoomSettings =
        serde_json::from_value(settings.clone()).map_err(|error| error.to_string())?;
    let proxy = match settings.network.hook.mode.as_str() {
        "" | "system" => RuntimeProxy::System,
        "disabled" => RuntimeProxy::Disabled,
        "custom" => {
            let protocol = settings.network.hook.protocol.trim();
            let address = settings.network.hook.address.trim();
            if !matches!(protocol, "http" | "https" | "socks5") || address.is_empty() {
                return Err("Hook 自定义代理配置无效".to_owned());
            }
            let url = format!("{protocol}://{address}");
            Proxy::all(&url).map_err(|error| format!("Hook 自定义代理配置无效：{error}"))?;
            RuntimeProxy::Custom(url)
        }
        mode => return Err(format!("Hook 不支持代理模式 `{mode}`")),
    };
    let changed = {
        // A poisoned lock is recovered rather than reported: the same reasoning as
        // `runtime_proxy`, plus one more. Returning an error here would mean an unrelated panic
        // permanently locks the user out of their own proxy settings, which is a worse outcome
        // than continuing from a value that provably cannot be half-written.
        let mut store = match proxy_store().write() {
            Ok(store) => store,
            Err(poisoned) => {
                let store = poisoned.into_inner();
                proxy_store().clear_poison();
                eprintln!(
                    "Hook proxy setting lock was poisoned by an earlier panic; applying the new setting anyway"
                );
                store
            }
        };
        let changed = *store != proxy;
        *store = proxy;
        changed
    };
    // The write lock is released before the cache is touched: `shared_client_with` takes
    // the cache lock and then the proxy read lock, so taking them in that order here too
    // would be a lock-order inversion.
    if changed {
        PROXY_GENERATION.fetch_add(1, Ordering::Release);
        // Dropping the old clients here rather than waiting for the next request means the
        // connections opened through the previous proxy are closed promptly, which is the
        // whole point of making a proxy change take effect without a restart.
        lock_client_cache().clients.clear();
    }
    Ok(())
}

fn endpoint_is_loopback(endpoint: &str) -> bool {
    let Ok(url) = Url::parse(endpoint) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

pub fn apply_to_url(
    builder: ClientBuilder,
    endpoint: &str,
) -> Result<ClientBuilder, reqwest::Error> {
    if endpoint_is_loopback(endpoint) {
        return Ok(builder.no_proxy());
    }
    match runtime_proxy() {
        RuntimeProxy::System => Ok(builder),
        RuntimeProxy::Disabled => Ok(builder.no_proxy()),
        RuntimeProxy::Custom(url) => Ok(builder.proxy(Proxy::all(url)?)),
    }
}

/// A proxy-aware client for `endpoint`, reused across calls.
///
/// Building a `reqwest::Client` per request throws away the connection pool and the TLS
/// configuration every time, so nothing is ever reused and every call pays a fresh
/// handshake — on a polling path, once per iteration. Prefer this over
/// `apply_to_url(Client::builder(), ..).build()` at any call site that runs more than once.
pub fn shared_client(endpoint: &str, timeout: Option<Duration>) -> Result<Client, reqwest::Error> {
    shared_client_with(endpoint, timeout, "default", |builder| builder)
}

/// [`shared_client`] for call sites that need extra builder options. `flavor` names the
/// customization and is part of the cache key, so two different customizations never share
/// a client; it must be a distinct constant per call site.
pub fn shared_client_with(
    endpoint: &str,
    timeout: Option<Duration>,
    flavor: &'static str,
    configure: impl FnOnce(ClientBuilder) -> ClientBuilder,
) -> Result<Client, reqwest::Error> {
    let key = ClientKey {
        loopback: endpoint_is_loopback(endpoint),
        timeout_millis: timeout.map(|timeout| timeout.as_millis() as u64),
        flavor,
    };
    let generation = PROXY_GENERATION.load(Ordering::Acquire);
    // Scoped so the cache guard is dropped before `apply_to_url` takes the proxy lock below.
    {
        let mut cache = lock_client_cache();
        if cache.generation != generation {
            cache.clients.clear();
            cache.generation = generation;
        }
        if let Some(client) = cache.clients.get(&key) {
            return Ok(client.clone());
        }
    }

    // Built outside the cache lock: `apply_to_url` takes the proxy lock, and holding both
    // would invert the order `apply_loom_settings` uses.
    let mut builder = apply_to_url(Client::builder(), endpoint)?;
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    let client = configure(builder).build()?;

    {
        let mut cache = lock_client_cache();
        // A proxy change that landed while this client was being built makes it stale
        // before it is ever cached; hand it to this one caller and let the next call
        // rebuild. Caching it would pin the old proxy for every later request.
        if cache.generation == generation && PROXY_GENERATION.load(Ordering::Acquire) == generation
        {
            if cache.clients.len() >= MAX_CACHED_CLIENTS {
                cache.clients.clear();
            }
            cache.clients.insert(key, client.clone());
        }
    }
    Ok(client)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every test here mutates the same process-wide proxy setting and client cache, so
    /// they must not overlap.
    static TEST_GUARD: Mutex<()> = Mutex::new(());

    fn cached_client_count() -> usize {
        lock_client_cache().clients.len()
    }

    /// Poisons `lock` by panicking while it is held, which is the only way a lock becomes
    /// poisoned. The panic hook is silenced for the duration so a passing run does not print a
    /// panic and a backtrace hint; `TEST_GUARD` keeps the two poison tests from overlapping.
    fn poison<T>(lock: impl FnOnce() -> T + Send + 'static) {
        let previous_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let outcome = std::thread::spawn(move || {
            let _held = lock();
            panic!("poisoning the lock on purpose");
        })
        .join();
        std::panic::set_hook(previous_hook);
        assert!(outcome.is_err(), "the poisoning thread must have panicked");
    }

    fn use_system_proxy() {
        apply_loom_settings(&serde_json::json!({
            "network": { "hook": { "mode": "system" } }
        }))
        .unwrap();
    }

    #[test]
    fn loom_settings_update_hook_proxy_runtime() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|error| error.into_inner());
        apply_loom_settings(&serde_json::json!({
            "network": {
                "hook": {
                    "mode": "custom",
                    "protocol": "socks5",
                    "address": "127.0.0.1:7890"
                }
            }
        }))
        .unwrap();
        assert_eq!(
            *proxy_store().read().unwrap(),
            RuntimeProxy::Custom("socks5://127.0.0.1:7890".to_owned())
        );
        assert!(apply_to_url(reqwest::Client::builder(), "https://example.com").is_ok());
        assert!(apply_to_url(reqwest::Client::builder(), "http://127.0.0.1:8765").is_ok());
        use_system_proxy();
    }

    #[test]
    fn shared_clients_are_reused_and_dropped_when_the_proxy_changes() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|error| error.into_inner());
        use_system_proxy();
        lock_client_cache().clients.clear();

        let timeout = Some(Duration::from_secs(10));
        shared_client("http://127.0.0.1:8765", timeout).unwrap();
        assert_eq!(cached_client_count(), 1);
        // A second loopback endpoint takes the same proxy decision, so it reuses the same
        // client instead of adding one — reqwest pools per host inside the client.
        shared_client("http://localhost:19820", timeout).unwrap();
        assert_eq!(cached_client_count(), 1);
        // A remote endpoint, a different timeout and a different flavor each need their own.
        shared_client("https://example.com", timeout).unwrap();
        assert_eq!(cached_client_count(), 2);
        shared_client("http://127.0.0.1:8765", Some(Duration::from_secs(20))).unwrap();
        assert_eq!(cached_client_count(), 3);
        shared_client("http://127.0.0.1:8765", None).unwrap();
        assert_eq!(cached_client_count(), 4);
        shared_client_with("http://127.0.0.1:8765", timeout, "image-fetch", |builder| {
            builder.user_agent("hook-test")
        })
        .unwrap();
        assert_eq!(cached_client_count(), 5);

        apply_loom_settings(&serde_json::json!({
            "network": { "hook": { "mode": "disabled" } }
        }))
        .unwrap();
        assert_eq!(cached_client_count(), 0);
        // Re-applying the same mode is not a change, so it must not throw away live pools.
        shared_client("https://example.com", timeout).unwrap();
        apply_loom_settings(&serde_json::json!({
            "network": { "hook": { "mode": "disabled" } }
        }))
        .unwrap();
        assert_eq!(cached_client_count(), 1);
        use_system_proxy();
        assert_eq!(cached_client_count(), 0);
    }

    #[test]
    fn shared_client_cache_stays_bounded_when_the_key_keeps_changing() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|error| error.into_inner());
        use_system_proxy();
        lock_client_cache().clients.clear();

        for millis in 1..=(MAX_CACHED_CLIENTS as u64 + 4) {
            shared_client("http://127.0.0.1:8765", Some(Duration::from_millis(millis))).unwrap();
            assert!(cached_client_count() <= MAX_CACHED_CLIENTS);
        }
        // The last insert still lands, so a caller past the cap keeps a usable cache rather
        // than an empty one.
        assert!(cached_client_count() > 0);
        lock_client_cache().clients.clear();
    }

    #[test]
    fn a_poisoned_proxy_lock_keeps_the_setting_the_user_chose() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|error| error.into_inner());
        apply_loom_settings(&serde_json::json!({
            "network": { "hook": { "mode": "disabled" } }
        }))
        .unwrap();

        poison(|| proxy_store().write().unwrap());
        assert!(proxy_store().is_poisoned());

        // Falling back to a default here would hand back `System` and quietly send this user's
        // traffic through the proxy they turned off.
        assert_eq!(runtime_proxy(), RuntimeProxy::Disabled);
        assert!(
            !proxy_store().is_poisoned(),
            "recovery must clear the poison so one panic does not degrade every later read"
        );

        // Poison again to prove the write half recovers too: a settings change must not be
        // refused forever because of an unrelated panic.
        poison(|| proxy_store().write().unwrap());
        assert!(proxy_store().is_poisoned());
        use_system_proxy();
        assert!(!proxy_store().is_poisoned());
        assert_eq!(runtime_proxy(), RuntimeProxy::System);
    }

    #[test]
    fn a_poisoned_client_cache_recovers_empty_and_keeps_caching() {
        let _guard = TEST_GUARD.lock().unwrap_or_else(|error| error.into_inner());
        use_system_proxy();
        let timeout = Some(Duration::from_secs(10));
        shared_client("http://127.0.0.1:8765", timeout).unwrap();
        assert!(cached_client_count() > 0);

        poison(|| client_cache().lock().unwrap());
        assert!(client_cache().is_poisoned());

        // Recovery empties the map rather than trusting a `HashMap` a panic ran through, so the
        // count restarts from the one client this call rebuilds.
        shared_client("http://127.0.0.1:8765", timeout).unwrap();
        assert!(!client_cache().is_poisoned());
        assert_eq!(cached_client_count(), 1);
        // And reuse still works afterwards — the cache is not left disabled.
        shared_client("http://127.0.0.1:8765", timeout).unwrap();
        assert_eq!(cached_client_count(), 1);
        lock_client_cache().clients.clear();
    }
}
