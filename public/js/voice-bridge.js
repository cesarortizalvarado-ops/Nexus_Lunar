export function detectVoiceCapabilities() {
  const RecognitionCtor =
    typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition || null : null;
  const hasMediaRecorder =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';
  const hasSpeechSynthesis =
    typeof window !== 'undefined' &&
    Boolean(window.speechSynthesis) &&
    typeof SpeechSynthesisUtterance !== 'undefined';

  return {
    speechRecognition: Boolean(RecognitionCtor),
    mediaRecorder: hasMediaRecorder,
    speechSynthesis: hasSpeechSynthesis,
  };
}

export function createVoiceBridge({ onTranscript, onStatusChange, onAudioClip, onError } = {}) {
  const capabilities = detectVoiceCapabilities();
  let mode = 'idle'; // 'idle' | 'listening' | 'recording'
  let recognition = null;
  let mediaRecorder = null;
  let mediaStream = null;
  let recordedChunks = [];

  function setMode(next) {
    mode = next;
    onStatusChange?.(mode, capabilities);
  }

  function stopRecognition() {
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // Ignorar si ya detuvo
    }
    recognition = null;
    setMode('idle');
  }

  function stopRecorder() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  async function toggleCapture() {
    if (mode === 'listening') {
      stopRecognition();
      return mode;
    }
    if (mode === 'recording') {
      stopRecorder();
      setMode('idle');
      return mode;
    }

    if (capabilities.speechRecognition) {
      const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new RecognitionCtor();
      recognition.lang = 'es-MX';
      recognition.interimResults = true;
      recognition.continuous = true;

      recognition.onresult = (event) => {
        let fullText = '';
        let isFinal = false;
        for (let i = 0; i < event.results.length; i += 1) {
          fullText += event.results[i][0].transcript;
          if (event.results[i].isFinal) isFinal = true;
        }
        onTranscript?.(fullText.trim(), isFinal);
      };

      recognition.onerror = (event) => {
        onError?.(`Dictado por voz interrumpido (${event.error || 'error'}). Puedes usar texto o grabación.`);
        recognition = null;
        setMode('idle');
      };

      recognition.onend = () => {
        recognition = null;
        setMode('idle');
      };

      recognition.start();
      setMode('listening');
      return mode;
    }

    if (capabilities.mediaRecorder) {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(mediaStream);
        mediaRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data);
        };
        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
          const url = URL.createObjectURL(blob);
          onAudioClip?.({
            url,
            mimeType: blob.type,
            notice: 'Clip grabado localmente (blob:). El transcriptor offline Whisper se conectará en el empaquetado de escritorio (Bloque 11).',
          });
          if (mediaStream) {
            mediaStream.getTracks().forEach((track) => track.stop());
            mediaStream = null;
          }
          setMode('idle');
        };
        mediaRecorder.start();
        setMode('recording');
        return mode;
      } catch (err) {
        if (mediaStream) {
          mediaStream.getTracks().forEach((track) => track.stop());
          mediaStream = null;
        }
        setMode('idle');
        onError?.(err?.message || 'No se pudo acceder al micrófono del sistema.');
        return mode;
      }
    }

    onError?.('Tu navegador/entorno no expone micrófono ni SpeechRecognition; la entrada por texto sigue operativa.');
    return mode;
  }

  function speakText(text, { onEnd = null } = {}) {
    if (!capabilities.speechSynthesis) {
      onError?.('Síntesis de voz (speechSynthesis) no disponible en este navegador.');
      return false;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text || ''));
    utterance.lang = 'es-MX';
    utterance.rate = 1.02;
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();
    window.speechSynthesis.speak(utterance);
    return true;
  }

  function stopSpeaking() {
    if (capabilities.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  function destroy() {
    stopRecognition();
    stopRecorder();
    stopSpeaking();
  }

  return {
    capabilities,
    getMode: () => mode,
    toggleCapture,
    speakText,
    stopSpeaking,
    destroy,
  };
}
