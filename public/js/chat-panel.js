import { apiFetch, escapeHtml, showToast, todayLocalIso } from './api.js';
import { state } from './state.js';
import { createVoiceBridge } from './voice-bridge.js';

export function createChatPanelController({ onSwitchView, onDataChanged }) {
  const selectEl = document.getElementById('chat-conversation-select');
  const newBtnEl = document.getElementById('chat-new-conv-btn');
  const modeBadgeEl = document.getElementById('chat-mode-badge');
  const ttsToggleEl = document.getElementById('chat-tts-toggle');
  const messagesEl = document.getElementById('chat-messages');
  const voiceSlotEl = document.getElementById('chat-voice-slot');
  const saturdaySlotEl = document.getElementById('chat-saturday-slot');
  const proposalsSlotEl = document.getElementById('chat-proposals-slot');
  const formEl = document.getElementById('chat-form');
  const inputEl = document.getElementById('chat-input');
  const voiceBtnEl = document.getElementById('chat-voice-btn');
  const sendBtnEl = document.getElementById('chat-send-btn');

  const voiceBridge = createVoiceBridge({
    onTranscript: (text) => {
      if (inputEl) inputEl.value = text;
    },
    onStatusChange: (mode) => {
      state.voiceState = mode;
      updateVoiceButton();
    },
    onAudioClip: (clip) => {
      if (state.voiceClip?.url) URL.revokeObjectURL(state.voiceClip.url);
      state.voiceClip = clip;
      renderVoiceSlot();
    },
    onError: (msg) => {
      showToast(msg, { type: 'info' });
    },
  });

  function updateVoiceButton() {
    if (!voiceBtnEl) return;
    const isListening = state.voiceState === 'listening';
    const isRecording = state.voiceState === 'recording';
    voiceBtnEl.disabled = false;
    voiceBtnEl.classList.toggle('voice-recording', isListening || isRecording);
    if (isListening) {
      voiceBtnEl.textContent = '⏹ Escuchando...';
    } else if (isRecording) {
      voiceBtnEl.textContent = '⏹ Grabando...';
    } else {
      voiceBtnEl.textContent = '🎙 Voz';
    }
  }

  function updateTtsButton() {
    if (!ttsToggleEl) return;
    ttsToggleEl.classList.toggle('btn-primary', state.ttsEnabled);
    ttsToggleEl.classList.toggle('btn-secondary', !state.ttsEnabled);
    ttsToggleEl.setAttribute('aria-pressed', state.ttsEnabled ? 'true' : 'false');
    ttsToggleEl.textContent = state.ttsEnabled ? '🔊 TTS ON' : '🔊 TTS';
  }

  function updateModeBadge() {
    if (!modeBadgeEl) return;
    const isAi = state.copilotMode === 'ai_assisted';
    modeBadgeEl.textContent = isAi ? 'IA Asistida' : 'Determinista Local';
    modeBadgeEl.className = `badge ${isAi ? 'badge-accent' : 'badge-ok'}`;
  }

  function renderConversationsSelect() {
    if (!selectEl) return;
    const options = [
      '<option value="">+ Nueva conversación</option>',
      ...state.conversations.map((conv) => {
        const label = `${conv.title || conv.conversation_type || 'Conversación'} (${String(conv.updated_at || conv.created_at || '').slice(0, 10)})`;
        const selected = conv.id === state.activeConversationId ? 'selected' : '';
        return `<option value="${escapeHtml(conv.id)}" ${selected}>${escapeHtml(label)}</option>`;
      }),
    ];
    selectEl.innerHTML = options.join('');
  }

  function renderMessages() {
    if (!messagesEl) return;
    if (!state.chatMessages.length) {
      messagesEl.innerHTML = `
        <div class="chat-empty">
          <strong>Copiloto local listo.</strong><br>
          Consulta tus finanzas, metas, calendario o escribe actualizaciones naturales. Ninguna mutación se ejecuta sin tu confirmación.
        </div>
      `;
      return;
    }

    messagesEl.innerHTML = state.chatMessages
      .map((msg) => {
        const role = msg.role === 'USER' ? 'user' : 'assistant';
        const roleLabel = role === 'user' ? 'Tú' : 'Copiloto';
        const timeStr = String(msg.created_at || '').slice(11, 16);
        const isSpeaking = state.speakingMessageId === msg.id;
        return `
          <div class="chat-msg ${role}">
            <div class="chat-msg-meta">
              <span>${roleLabel}</span>
              <div style="display:flex;align-items:center;gap:6px;">
                <span class="mono">${escapeHtml(timeStr)}</span>
                ${
                  role === 'assistant'
                    ? `<button type="button" class="btn btn-secondary btn-sm chat-tts-msg-btn" data-msg-id="${escapeHtml(msg.id)}" style="padding:2px 6px;font-size:10px;">${isSpeaking ? '⏹ Detener' : '🔊 Leer'}</button>`
                    : ''
                }
              </div>
            </div>
            <div>${escapeHtml(msg.content)}</div>
          </div>
        `;
      })
      .join('');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderVoiceSlot() {
    if (!voiceSlotEl) return;
    if (!state.voiceClip) {
      voiceSlotEl.innerHTML = '';
      return;
    }
    voiceSlotEl.innerHTML = `
      <div class="chat-slot-inner">
        <div class="voice-status-bar" style="flex-direction:column;align-items:stretch;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <strong>Audio local grabado</strong>
            <button type="button" class="btn btn-secondary btn-sm" id="chat-discard-voice-btn">Descartar</button>
          </div>
          <audio controls src="${escapeHtml(state.voiceClip.url)}"></audio>
          <small>${escapeHtml(state.voiceClip.notice)}</small>
        </div>
      </div>
    `;
  }

  function renderSaturdayCard() {
    if (!saturdaySlotEl) return;
    if (!state.saturdayReview) {
      saturdaySlotEl.innerHTML = '';
      return;
    }
    saturdaySlotEl.innerHTML = `
      <div class="chat-slot-inner">
        <div class="chat-saturday-card">
          <div>
            <strong>Borrador semanal generado desde el chat (pendiente de aprobación)</strong>
            <div style="color:var(--text-secondary);margin-top:2px;">
              Inicio: <span class="mono">${escapeHtml(state.saturdayReview.nextWeekDraft?.weekStartDate || '-')}</span> · Sin sellar hasta confirmación humana.
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="chat-open-plan-btn">Abrir en Plan Semanal</button>
        </div>
      </div>
    `;
  }

  function renderProposalsQueue() {
    if (!proposalsSlotEl) return;
    if (!state.copilotQueue.length) {
      proposalsSlotEl.innerHTML = '';
      return;
    }
    proposalsSlotEl.innerHTML = `
      <div class="chat-slot-inner">
        <div class="eyebrow">Propuestas Pendientes (${state.copilotQueue.length})</div>
        ${state.copilotQueue
          .map(
            (prop, idx) => `
          <div class="chat-proposal-card">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <span class="badge badge-accent">${escapeHtml(prop.type)}</span>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn btn-primary btn-sm chat-apply-prop-btn" data-prop-index="${idx}">Confirmar y Aplicar</button>
                <button type="button" class="btn btn-secondary btn-sm chat-discard-prop-btn" data-prop-index="${idx}">Descartar</button>
              </div>
            </div>
            <div class="mono" style="font-size:11px;color:var(--text-secondary);">${escapeHtml(JSON.stringify(prop.payload))}</div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  function renderAll() {
    updateModeBadge();
    updateTtsButton();
    updateVoiceButton();
    renderConversationsSelect();
    renderMessages();
    renderVoiceSlot();
    renderSaturdayCard();
    renderProposalsQueue();
  }

  async function loadConversationMessages(conversationId) {
    if (!conversationId) {
      state.activeConversationId = null;
      state.chatMessages = [];
      renderAll();
      return;
    }
    try {
      const messages = await apiFetch(`/api/copilot/conversations/${encodeURIComponent(conversationId)}/messages`);
      state.activeConversationId = conversationId;
      state.chatMessages = Array.isArray(messages) ? messages : [];
      const lastAssistant = [...state.chatMessages].reverse().find((m) => m.role === 'ASSISTANT');
      if (lastAssistant?.metadata?.mode) {
        state.copilotMode = lastAssistant.metadata.mode;
      }
      renderAll();
    } catch (err) {
      showToast(err.message, { type: 'err', remediation: err.remediation });
    }
  }

  async function refreshConversations() {
    try {
      const list = await apiFetch('/api/copilot/conversations');
      state.conversations = Array.isArray(list) ? list : [];
      if (!state.activeConversationId && state.conversations.length > 0) {
        state.activeConversationId = state.conversations[0].id;
      }
      if (state.activeConversationId) {
        await loadConversationMessages(state.activeConversationId);
      } else {
        state.chatMessages = [];
        renderAll();
      }
    } catch (err) {
      showToast(err.message, { type: 'err', remediation: err.remediation });
    }
  }

  async function applyProposal(idx) {
    const prop = state.copilotQueue[idx];
    if (!prop) return;

    if (prop.type === 'update_weight') {
      await apiFetch('/api/spaces/biometrics', {
        method: 'PATCH',
        body: JSON.stringify({ currentWeightKg: prop.payload.currentWeightKg }),
      });
    } else if (prop.type === 'record_payment') {
      await apiFetch('/api/spaces/commitments/payments', {
        method: 'POST',
        body: JSON.stringify(prop.payload),
      });
    } else if (prop.type === 'log_execution') {
      const targetBaselineId = prop.payload.baselineId || state.selectedBaselineId;
      if (!targetBaselineId) {
        throw new Error('Selecciona una baseline activa en Plan Semanal para registrar la ejecución.');
      }
      await apiFetch(`/api/planning/baselines/${encodeURIComponent(targetBaselineId)}/executions`, {
        method: 'POST',
        body: JSON.stringify(prop.payload),
      });
    } else {
      showToast(`Revisa "${prop.type}" directamente en Perfil y Mini-Apps para confirmarlo.`, { type: 'info' });
      onSwitchView('spaces');
      return;
    }

    state.copilotQueue.splice(idx, 1);
    showToast(`Propuesta "${prop.type}" confirmada y aplicada.`, { type: 'ok' });
    renderAll();
    await onDataChanged();
  }

  selectEl?.addEventListener('change', async () => {
    const chosenId = selectEl.value || null;
    await loadConversationMessages(chosenId);
  });

  newBtnEl?.addEventListener('click', () => {
    state.activeConversationId = null;
    state.chatMessages = [];
    renderAll();
    inputEl?.focus();
  });

  ttsToggleEl?.addEventListener('click', () => {
    state.ttsEnabled = !state.ttsEnabled;
    if (!state.ttsEnabled) {
      voiceBridge.stopSpeaking();
      state.speakingMessageId = null;
    }
    updateTtsButton();
    renderMessages();
  });

  voiceBtnEl?.addEventListener('click', async () => {
    await voiceBridge.toggleCapture();
  });

  voiceSlotEl?.addEventListener('click', (e) => {
    if (e.target.id === 'chat-discard-voice-btn') {
      if (state.voiceClip?.url) URL.revokeObjectURL(state.voiceClip.url);
      state.voiceClip = null;
      renderVoiceSlot();
    }
  });

  messagesEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.chat-tts-msg-btn');
    if (!btn) return;
    const msgId = btn.dataset.msgId;
    if (state.speakingMessageId === msgId) {
      voiceBridge.stopSpeaking();
      state.speakingMessageId = null;
      renderMessages();
      return;
    }
    const msg = state.chatMessages.find((m) => m.id === msgId);
    if (!msg) return;
    state.speakingMessageId = msgId;
    renderMessages();
    voiceBridge.speakText(msg.content, {
      onEnd: () => {
        state.speakingMessageId = null;
        renderMessages();
      },
    });
  });

  saturdaySlotEl?.addEventListener('click', (e) => {
    if (e.target.id === 'chat-open-plan-btn') {
      state.planSubMode = 'saturday';
      onSwitchView('plan');
    }
  });

  proposalsSlotEl?.addEventListener('click', async (e) => {
    const applyBtn = e.target.closest('.chat-apply-prop-btn');
    if (applyBtn) {
      try {
        await applyProposal(Number(applyBtn.dataset.propIndex));
      } catch (err) {
        showToast(err.message, { type: 'err', remediation: err.remediation });
      }
      return;
    }

    const discardBtn = e.target.closest('.chat-discard-prop-btn');
    if (discardBtn) {
      const idx = Number(discardBtn.dataset.propIndex);
      state.copilotQueue.splice(idx, 1);
      renderProposalsQueue();
    }
  });

  formEl?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.copilotSending) return;
    const message = inputEl?.value?.trim();
    if (!message) return;

    state.copilotSending = true;
    if (sendBtnEl) sendBtnEl.disabled = true;

    try {
      const referenceDate = todayLocalIso(state.health?.timezone);
      const res = await apiFetch('/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: state.activeConversationId,
          message,
          referenceDate,
        }),
      });

      state.activeConversationId = res.conversationId;
      state.copilotMode = res.mode || 'deterministic_local';
      if (Array.isArray(res.acceptedProposals) && res.acceptedProposals.length > 0) {
        state.copilotQueue = [...state.copilotQueue, ...res.acceptedProposals];
      }
      if (Array.isArray(res.rejectedProposals) && res.rejectedProposals.length > 0) {
        state.copilotRejected = res.rejectedProposals;
      }
      if (res.saturdayReview) {
        state.saturdayReview = res.saturdayReview;
      }

      if (inputEl) inputEl.value = '';
      await refreshConversations();
      if (state.ttsEnabled && res.assistantMessage?.content) {
        state.speakingMessageId = res.assistantMessage.id;
        renderMessages();
        voiceBridge.speakText(res.assistantMessage.content, {
          onEnd: () => {
            state.speakingMessageId = null;
            renderMessages();
          },
        });
      }
      await onDataChanged({ silentViewRefresh: !res.saturdayReview });
    } catch (err) {
      showToast(err.message, { type: 'err', remediation: err.remediation });
    } finally {
      state.copilotSending = false;
      if (sendBtnEl) sendBtnEl.disabled = false;
    }
  });

  return {
    init: refreshConversations,
    render: renderAll,
    destroy: () => voiceBridge.destroy(),
  };
}
