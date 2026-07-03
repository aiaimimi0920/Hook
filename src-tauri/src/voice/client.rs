use crate::voice::core::{VoiceError, VoiceMode};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrontContext {
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub selected_text: Option<String>,
}

#[async_trait]
pub trait Transcriber: Send + Sync {
    async fn transcribe(
        &self,
        audio_path: PathBuf,
        context: FrontContext,
    ) -> Result<String, VoiceError>;
}

#[async_trait]
pub trait TextProcessor: Send + Sync {
    async fn process(
        &self,
        transcript: String,
        mode: VoiceMode,
        context: FrontContext,
    ) -> Result<String, VoiceError>;
}

#[derive(Debug, Clone)]
pub struct MockTranscriber {
    transcript: String,
}

impl MockTranscriber {
    pub fn new(transcript: impl Into<String>) -> Self {
        Self {
            transcript: transcript.into(),
        }
    }
}

#[async_trait]
impl Transcriber for MockTranscriber {
    async fn transcribe(
        &self,
        _audio_path: PathBuf,
        _context: FrontContext,
    ) -> Result<String, VoiceError> {
        Ok(self.transcript.clone())
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct NoopTextProcessor;

#[async_trait]
impl TextProcessor for NoopTextProcessor {
    async fn process(
        &self,
        transcript: String,
        _mode: VoiceMode,
        _context: FrontContext,
    ) -> Result<String, VoiceError> {
        Ok(transcript)
    }
}

#[derive(Debug, Clone)]
pub struct HttpTranscriber {
    endpoint: String,
    client: reqwest::Client,
}

impl HttpTranscriber {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            client: reqwest::Client::new(),
        }
    }
}

#[derive(Debug, Serialize)]
struct HttpTranscribeRequest {
    audio_path: String,
    context: FrontContext,
}

#[derive(Debug, Deserialize)]
struct TextResponse {
    text: String,
}

#[async_trait]
impl Transcriber for HttpTranscriber {
    async fn transcribe(
        &self,
        audio_path: PathBuf,
        context: FrontContext,
    ) -> Result<String, VoiceError> {
        let response = self
            .client
            .post(&self.endpoint)
            .json(&HttpTranscribeRequest {
                audio_path: audio_path.display().to_string(),
                context,
            })
            .send()
            .await
            .map_err(|error| VoiceError::Provider(error.to_string()))?;

        if !response.status().is_success() {
            return Err(VoiceError::Provider(format!(
                "transcriber returned HTTP {}",
                response.status()
            )));
        }

        let body = response
            .json::<TextResponse>()
            .await
            .map_err(|error| VoiceError::Provider(error.to_string()))?;
        Ok(body.text)
    }
}

#[derive(Debug, Clone)]
pub struct HttpTextProcessor {
    endpoint: String,
    client: reqwest::Client,
}

impl HttpTextProcessor {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            client: reqwest::Client::new(),
        }
    }
}

#[derive(Debug, Serialize)]
struct HttpProcessRequest {
    transcript: String,
    mode: VoiceMode,
    context: FrontContext,
}

#[async_trait]
impl TextProcessor for HttpTextProcessor {
    async fn process(
        &self,
        transcript: String,
        mode: VoiceMode,
        context: FrontContext,
    ) -> Result<String, VoiceError> {
        let response = self
            .client
            .post(&self.endpoint)
            .json(&HttpProcessRequest {
                transcript,
                mode,
                context,
            })
            .send()
            .await
            .map_err(|error| VoiceError::Provider(error.to_string()))?;

        if !response.status().is_success() {
            return Err(VoiceError::Provider(format!(
                "text processor returned HTTP {}",
                response.status()
            )));
        }

        let body = response
            .json::<TextResponse>()
            .await
            .map_err(|error| VoiceError::Provider(error.to_string()))?;
        Ok(body.text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_transcriber_and_noop_processor_return_expected_text() {
        let transcriber = MockTranscriber::new("hello neuro");
        let context = FrontContext::default();
        let transcript = transcriber
            .transcribe(PathBuf::from("sample.wav"), context.clone())
            .await
            .expect("mock transcript");

        assert_eq!(transcript, "hello neuro");

        let processor = NoopTextProcessor;
        let processed = processor
            .process(transcript, VoiceMode::Dictate, context)
            .await
            .expect("noop process");

        assert_eq!(processed, "hello neuro");
    }
}
