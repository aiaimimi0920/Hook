use hook_lib::tea_client::{
    HookAttachment, HookContext, HookIntakeRequest, TeaIntakeClient, TeaIntakeConfig,
};
use serde_json::{json, Value};
use std::time::Duration;

#[tokio::test]
#[ignore = "requires a running tea-daemon; use scripts/smoke-hook-tea-real.ps1"]
async fn hook_client_creates_ticket_in_real_tea_daemon() -> Result<(), Box<dyn std::error::Error>> {
    let base_url = required_env("TEA_REAL_SMOKE_BASE_URL")?;
    let auth_token = required_env("TEA_REAL_SMOKE_AUTH_TOKEN")?;
    let result_path = std::env::var("TEA_REAL_SMOKE_RESULT_PATH").ok();

    let client = TeaIntakeClient::new(TeaIntakeConfig {
        base_url: base_url.clone(),
        auth_token: auth_token.clone(),
        source: "hook-real-smoke".to_string(),
        enabled: true,
    });
    let ticket = client
        .create_ticket(HookIntakeRequest {
            source: "hook-real-smoke".to_string(),
            text: "Please create a real Hook to Tea smoke ticket".to_string(),
            context: HookContext {
                active_window: Some("PowerShell".to_string()),
                selection_text: Some("real daemon smoke".to_string()),
                ocr_text: None,
                screenshot_ref: Some("file://hook-real-smoke.png".to_string()),
                cwd: Some("C:\\Users\\Public\\nas_home\\AI\\GameEditor\\Neuro".to_string()),
                app: Some("hook".to_string()),
            },
            attachments: vec![HookAttachment {
                kind: "screenshot".to_string(),
                reference: "file://hook-real-smoke.png".to_string(),
            }],
        })
        .await?;

    assert_eq!(ticket.status, "open");
    assert!(ticket.labels.contains(&"source:hook".to_string()));
    assert!(ticket.labels.contains(&"policy:plan-only".to_string()));
    assert!(ticket.labels.contains(&"context:untrusted".to_string()));

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()?;
    let api_ticket: Value = get_json(
        &http,
        &base_url,
        &auth_token,
        &format!("/v1/tickets/{}", ticket.id),
    )
    .await?;
    assert_eq!(api_ticket["id"], ticket.id);
    assert_eq!(api_ticket["source"], "hook");
    assert_eq!(api_ticket["approval_policy"], "plan_only");
    assert!(api_ticket["description"]
        .as_str()
        .unwrap_or_default()
        .contains("--- Hook context (untrusted) ---"));
    assert!(api_ticket["description"]
        .as_str()
        .unwrap_or_default()
        .contains("selection_text: real daemon smoke"));

    let events: Value = get_json(
        &http,
        &base_url,
        &auth_token,
        &format!("/v1/tickets/{}/events", ticket.id),
    )
    .await?;
    let event_kinds = events
        .as_array()
        .ok_or("events response should be an array")?
        .iter()
        .filter_map(|event| event["kind"].as_str())
        .collect::<Vec<_>>();
    assert!(event_kinds.contains(&"ticket_created"));

    let markdown = get_text(
        &http,
        &base_url,
        &auth_token,
        &format!("/v1/tickets/{}/export/markdown", ticket.id),
    )
    .await?;
    assert!(markdown.contains("Please create a real Hook to Tea smoke ticket"));
    assert!(markdown.contains("TicketCreated"));

    if let Some(path) = result_path {
        let path = std::path::PathBuf::from(path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(
            path,
            serde_json::to_string_pretty(&json!({
                "ticket": api_ticket,
                "events": events,
                "markdown": markdown,
            }))?,
        )?;
    }

    Ok(())
}

async fn get_json(
    http: &reqwest::Client,
    base_url: &str,
    auth_token: &str,
    path: &str,
) -> Result<Value, Box<dyn std::error::Error>> {
    let text = get_text(http, base_url, auth_token, path).await?;
    Ok(serde_json::from_str(&text)?)
}

async fn get_text(
    http: &reqwest::Client,
    base_url: &str,
    auth_token: &str,
    path: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let response = http.get(url).bearer_auth(auth_token).send().await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(format!("Tea API returned {status}: {body}").into());
    }
    Ok(body)
}

fn required_env(name: &str) -> Result<String, Box<dyn std::error::Error>> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{name} is required for real Tea smoke").into())
}
