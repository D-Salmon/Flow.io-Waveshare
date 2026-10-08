(function (global) {
  'use strict';
  var pages = global.FlowWebPages = global.FlowWebPages || {};
  function create({ bindClickAction, createFormPostOptions, currentWebLocaleTag, getActivePageId,
    getStorageValue, isFlowIOProfile, isSupervisorProfile, isWaveshareProfile, loadWebMeta,
    normalizeUpgradeHttpErrorMessage, readUpgradeUiSession, runAsyncTaskSafely,
    setStorageValue, tr, upgradeUiSessionStorageKey, waitMs, createTimeoutRunner, createIntervalRunner, webDeviceMeta, fetchOkJson }) {
    const upgradeStatusPollActiveMs = 900;
    const upgradeStatusPollReconnectMs = 5000;
    const upgradeStatusPollDoneMs = 7000;
    const upgradeStatusPollIdleMs = 15000;
    const upgradeStatusPollErrorMs = 10000;
    function currentUpgradeStatusPollDelayMs() {
      const current = readUpgradeUiSession();
      const phase = String(current && current.phase ? current.phase : 'idle');
      if (current && (current.awaitingReconnect || phase === 'reboot' || phase === 'reconnect')) {
        return upgradeStatusPollReconnectMs;
      }
      if (phase === 'target' || phase === 'download' || phase === 'flash') {
        return upgradeStatusPollActiveMs;
      }
      if (phase === 'done') return upgradeStatusPollDoneMs;
      if (phase === 'error') return upgradeStatusPollErrorMs;
      return upgradeStatusPollIdleMs;
    }

    function scheduleNextUpgradeStatusPoll(delayMs) {
      if (document.hidden || getActivePageId() !== 'page-system') return;
      const nextDelay = Math.max(0, Number.isFinite(delayMs) ? delayMs : currentUpgradeStatusPollDelayMs());
      upgradeStatusPoller.schedule(nextDelay);
    }

    async function pollUpgradeStatusTick() {
      if (document.hidden || getActivePageId() !== 'page-system') return;
      await refreshUpgradeStatus();
      scheduleNextUpgradeStatusPoll();
    }

    function startUpgradeStatusPolling(immediate) {
      if (immediate) {
        scheduleNextUpgradeStatusPoll(0);
        return;
      }
      scheduleNextUpgradeStatusPoll();
    }

    function stopUpgradeStatusPolling() {
      upgradeStatusPoller.stop();
    }

    const checkUpdatesBtn = document.getElementById('checkUpdates');
    const localReleaseFileInput = document.getElementById('localReleaseFile');
    const localReleaseSelectBtn = document.getElementById('localReleaseSelect');
    const localReleaseSummary = document.getElementById('localReleaseSummary');
    const cancelUpgradeUiBtn = document.getElementById('cancelUpgradeUi');
    const upgradeTableBody = document.getElementById('upgradeTableBody');
    const upgradeProgressBar = document.getElementById('upgradeProgressBar');
    const upgradePct = document.getElementById('upgradePct');
    const upgradeJourneyLabel = document.getElementById('upgradeJourneyLabel');
    const upgradeSteps = document.getElementById('upgradeSteps');
    const upgradeFooterStatus = document.getElementById('upgradeFooterStatus');
    const upgradeProgressPanel = document.getElementById('upgradeProgressPanel');
    const upStatusChip = document.getElementById('upStatusChip');

    let upgradeManifestState = { manifest: null, manifestUrl: '', baseUrl: '', nextion: null };
    const upgradeReconnectFetchTimeoutMs = 1400;
    const upgradeTargetDefs = {
      flowios3: { manifestKey: 'flowios3', target: 'flowios3', endpoint: '/fwupdate/waveshare', label: 'FlowIOS3', order: 10 },
      waveshare: { manifestKey: 'waveshare', target: 'waveshare', endpoint: '/fwupdate/waveshare', label: 'Waveshare', order: 10 },
      esp32s3: { manifestKey: 'esp32s3', target: 'esp32s3', endpoint: '/fwupdate/waveshare', label: 'ESP32-S3', order: 11 },
      'flowios3-spiffs': { manifestKey: 'flowios3-spiffs', target: 'spiffs', endpoint: '/fwupdate/spiffs', label: 'SPIFFS FlowIOS3', order: 39 },
      'esp32s3-spiffs': { manifestKey: 'esp32s3-spiffs', target: 'spiffs', endpoint: '/fwupdate/spiffs', label: 'SPIFFS ESP32-S3', order: 39 },
      'waveshare-spiffs': { manifestKey: 'waveshare-spiffs', target: 'spiffs', endpoint: '/fwupdate/spiffs', label: 'SPIFFS Waveshare', order: 39 },
      nextion: { manifestKey: 'nextion', target: 'nextion', endpoint: '/fwupdate/nextion', label: 'Nextion', order: 30 },
      spiffs: { manifestKey: 'spiffs', target: 'spiffs', endpoint: '/fwupdate/spiffs', label: 'SPIFFS', order: 40 }
    };
    const upgradeComponentDefs = [
      {
        key: 'flowio',
        title: 'FlowIOS3',
        subtitle: 'Firmware Waveshare',
        icon: 'layers',
        tone: 'blue'
      },
      {
        key: 'spiffs',
        title: 'SPIFFS',
        subtitle: 'Fichiers système',
        icon: 'memory',
        tone: 'green'
      },
      {
        key: 'nextion',
        title: 'Nextion',
        subtitle: 'Unknown',
        icon: 'display_settings',
        tone: 'orange'
      }
    ];

    let upgradeUiStatusMuted = false;
    const upgradeStatusPoller = createTimeoutRunner(() => pollUpgradeStatusTick());
    const upgradeReconnectStageTimer = createTimeoutRunner(() => enterUpgradeReconnectPhase());
    const upgradeReconnectMonitor = createIntervalRunner(() => probeUpgradeReconnect(), 1500);
    function setUpgradeProgress(value) {
      const p = Math.max(0, Math.min(100, Number(value) || 0));
      if (upgradeProgressBar) {
        upgradeProgressBar.style.width = p + '%';
        upgradeProgressBar.classList.toggle('is-complete', p >= 100);
      }
      if (upgradePct) {
        upgradePct.textContent = p + '%';
      }
    }

    function setUpgradeMessage(text) {
      const message = String(text || '').trim() || tr('updates.none', 'Aucune opération en cours.');
      if (upgradeFooterStatus) {
        upgradeFooterStatus.innerHTML = '<span class="sdot"></span>' + message;
      }
    }

    function writeUpgradeUiSession(session) {
      if (!session || typeof session !== 'object') return;
      setStorageValue(sessionStorage, upgradeUiSessionStorageKey, JSON.stringify(session));
    }

    function clearUpgradeUiSession() {
      stopUpgradeReconnectFlow();
      try {
        sessionStorage.removeItem(upgradeUiSessionStorageKey);
      } catch (err) {
      }
    }

    function upgradeTargetLabel(target) {
      const key = String(target || '').trim().toLowerCase();
      if (key === 'flowios3' || key === 'esp32s3') return 'FlowIOS3';
      if (key === 'waveshare') return 'FlowIOS3';
      if (key === 'spiffs') return 'SPIFFS';
      if (key === 'nextion') return 'Nextion';
      if (key === 'release') return 'Flow.IO';
      return 'Firmware';
    }

    function upgradeUsesReconnect(target) {
      const key = String(target || '').trim().toLowerCase();
      return key === 'flowios3' || key === 'esp32s3' || key === 'waveshare' || key === 'spiffs' || key === 'nextion';
    }

    function upgradeStepDefinitions(target) {
      return [
        { id: 'target', label: tr('updates.step.target', 'Initialisation') },
        { id: 'download', label: tr('updates.step.download', 'Connexion') },
        { id: 'flash', label: tr('updates.step.flash', 'Mise à jour') },
        { id: 'reboot', label: tr('updates.step.reboot', 'Redémarrage') },
        { id: 'reconnect', label: tr('updates.step.reconnect', 'Reconnexion') }
      ];
    }

    function upgradePhaseIndex(phase) {
      if (phase === 'target') return 0;
      if (phase === 'download') return 1;
      if (phase === 'flash') return 2;
      if (phase === 'reboot') return 3;
      if (phase === 'reconnect') return 4;
      if (phase === 'done') return 5;
      return -1;
    }

    function upgradePhasePercent(session) {
      const phase = String(session && session.phase ? session.phase : 'idle');
      const progress = Math.max(0, Math.min(100, Number(session && session.backendProgress) || 0));
      const reconnectProgress = Math.max(0, Math.min(100, Number(session && session.reconnectProgress) || 0));
      if (phase === 'target') return 1;
      if (phase === 'download') return 1 + Math.round(progress * 0.04);
      if (phase === 'flash') return 5 + Math.round(progress * 0.90);
      if (phase === 'reboot') return 97;
      if (phase === 'reconnect') return 97 + Math.round(reconnectProgress * 0.03);
      if (phase === 'done') return 100;
      if (phase === 'error') return Math.max(6, Math.min(96, Number(session && session.lastPercent) || 12));
      return 0;
    }

    function upgradeStepProgress(stepId, state, session) {
      if (state === 'done') return 100;
      if (state !== 'active') return null;
      const phase = String(session && session.phase ? session.phase : '');
      if (stepId !== phase) return null;
      if (phase === 'target') return 100;
      if (phase === 'download' || phase === 'flash') {
        return Math.max(0, Math.min(100, Number(session && session.backendProgress) || 0));
      }
      if (phase === 'reboot') return 100;
      if (phase === 'reconnect') {
        return Math.max(0, Math.min(100, Number(session && session.reconnectProgress) || 0));
      }
      if (phase === 'done') return 100;
      return null;
    }

    function upgradeStepStatusLabel(stepId, state, session) {
      if (state === 'done') return tr('updates.step.status.done', 'Terminé');
      const progress = upgradeStepProgress(stepId, state, session);
      if (state === 'active') {
        return progress !== null
          ? tr('updates.step.status.inProgressPct', 'En cours ({pct}%)').replace('{pct}', String(progress))
          : tr('updates.step.status.inProgress', 'En cours');
      }
      if (state === 'pending') return tr('updates.step.status.pending', 'En attente');
      if (state === 'error') return tr('updates.step.status.error', 'Erreur');
      return tr('updates.step.status.pending', 'En attente');
    }

    function upgradeStepState(stepId, session) {
      const phase = String(session && session.phase ? session.phase : 'idle');
      if (phase === 'idle') return 'pending';
      if (phase === 'error') {
        const failedStep = String(session && session.failedStep ? session.failedStep : 'flash');
        const failedIndex = upgradePhaseIndex(failedStep);
        const stepIndex = upgradePhaseIndex(stepId);
        if (stepIndex < failedIndex) return 'done';
        if (stepId === failedStep) return 'error';
        return 'pending';
      }
      const activeIndex = upgradePhaseIndex(phase);
      const stepIndex = upgradePhaseIndex(stepId);
      if (stepIndex < activeIndex) return 'done';
      if (stepIndex === activeIndex) return phase === 'done' ? 'done' : 'active';
      return 'pending';
    }

    function renderUpgradeSteps(session) {
      if (!upgradeSteps) return;
      const defs = upgradeStepDefinitions(session && session.target);
      upgradeSteps.innerHTML = '';
      defs.forEach((step) => {
        const state = upgradeStepState(step.id, session);
        const row = document.createElement('div');
        row.className = 'step-row';

        const icon = document.createElement('span');
        icon.className = 'step-ic ' + state;
        if (state === 'active') {
          const activeDot = document.createElement('span');
          activeDot.className = 'step-active-dot';
          activeDot.setAttribute('aria-hidden', 'true');
          icon.appendChild(activeDot);
        } else if (state === 'done') {
          const doneIcon = document.createElement('span');
          doneIcon.className = 'ui-msr';
          doneIcon.setAttribute('aria-hidden', 'true');
          doneIcon.textContent = 'check';
          icon.appendChild(doneIcon);
        } else if (state === 'error') {
          const errIcon = document.createElement('span');
          errIcon.className = 'ui-msr';
          errIcon.setAttribute('aria-hidden', 'true');
          errIcon.textContent = 'close';
          icon.appendChild(errIcon);
        } else {
          const pendingIcon = document.createElement('span');
          pendingIcon.className = 'ui-msr';
          pendingIcon.setAttribute('aria-hidden', 'true');
          pendingIcon.textContent = 'radio_button_unchecked';
          icon.appendChild(pendingIcon);
        }
        row.appendChild(icon);

        const meta = document.createElement('span');
        meta.className = 'step-meta';

        const label = document.createElement('span');
        label.className = 'step-lbl ' + state;
        label.textContent = step.label;
        meta.appendChild(label);

        const sub = document.createElement('span');
        sub.className = 'step-sub ' + state;
        sub.textContent = upgradeStepStatusLabel(step.id, state, session);
        meta.appendChild(sub);

        row.appendChild(meta);

        upgradeSteps.appendChild(row);
      });
    }

    function isUpgradeUiCancelable(session) {
      const phase = String(session && session.phase ? session.phase : 'idle');
      return !!(session && (session.awaitingReconnect || phase === 'target' || phase === 'download' || phase === 'flash' || phase === 'reboot' || phase === 'reconnect'));
    }

    function syncUpgradeCancelButton(session) {
      if (!cancelUpgradeUiBtn) return;
      const canCancel = isUpgradeUiCancelable(session);
      cancelUpgradeUiBtn.hidden = !canCancel;
      cancelUpgradeUiBtn.disabled = !canCancel;
    }

    function renderUpgradeJourney(session) {
      const safeSession = session && typeof session === 'object' ? session : { phase: 'idle', target: '' };
      const phase = String(safeSession.phase || 'idle');
      const detail = String(safeSession.detail || '');
      const targetLabel = upgradeTargetLabel(safeSession.target);
      if (upgradeProgressPanel) {
        const progressVisible = phase === 'target' || phase === 'download' || phase === 'flash'
          || phase === 'reboot' || phase === 'reconnect';
        upgradeProgressPanel.hidden = !progressVisible;
      }
      const stateLabel = phase === 'idle'
        ? tr('updates.phase.idle', 'Prêt')
        : phase === 'target'
          ? tr('updates.phase.target', 'Cible sélectionnée')
          : phase === 'download'
            ? tr('updates.phase.download', 'Téléchargement')
            : phase === 'flash'
              ? tr('updates.phase.flash', 'Mise à jour')
              : phase === 'reboot'
                ? tr('updates.phase.reboot', 'Redémarrage')
                : phase === 'reconnect'
                  ? tr('updates.phase.reconnect', 'Attente de Reconnection')
                  : phase === 'done'
                    ? tr('updates.phase.done', 'Mise à jour terminée')
                    : tr('updates.phase.error', 'Erreur');

      if (upgradeJourneyLabel) {
        upgradeJourneyLabel.textContent = safeSession.target
          ? (tr('updates.progress', 'Statut de l’upgrade') + ' · ' + targetLabel)
          : tr('updates.progress', 'Statut de l’upgrade');
      }
      setUpgradeProgress(upgradePhasePercent(safeSession));
      setUpgradeMessage(detail || (phase === 'idle' ? tr('updates.none', 'Aucune opération en cours.') : stateLabel));
      renderUpgradeSteps(safeSession);
      if (upStatusChip) {
        upStatusChip.textContent = stateLabel;
      }
      syncUpgradeCancelButton(safeSession);
    }

    function updateUpgradeUiSession(patch) {
      const current = readUpgradeUiSession() || {
        phase: 'idle',
        target: '',
        detail: tr('updates.none', 'Aucune opération en cours.'),
        backendProgress: 0,
        lastPercent: 0,
        awaitingReconnect: false,
        reconnectShown: false,
        reconnectProgress: 0,
        operationId: 0,
        bootId: 0
      };
      const next = Object.assign({}, current, patch || {});
      next.lastPercent = upgradePhasePercent(next);
      writeUpgradeUiSession(next);
      renderUpgradeJourney(next);
      return next;
    }

    function startUpgradeUiSession(target) {
      stopUpgradeReconnectFlow();
      upgradeUiStatusMuted = false;
      return updateUpgradeUiSession({
        phase: 'target',
        target: target,
        detail: tr('updates.detail.targetSelected', 'Sélection de la cible {target}.')
          .replace('{target}', upgradeTargetLabel(target)),
        backendProgress: 0,
        awaitingReconnect: false,
        reconnectShown: false,
        reconnectProgress: 0,
        operationId: 0,
        bootId: 0,
        failedStep: ''
      });
    }

    function cancelUpgradeUiSession() {
      upgradeUiStatusMuted = true;
      stopUpgradeStatusPolling();
      clearUpgradeUiSession();
      renderUpgradeJourney({
        phase: 'idle',
        target: '',
        detail: tr('updates.none', 'Aucune opération en cours.')
      });
    }

    function stopUpgradeReconnectFlow() {
      upgradeReconnectStageTimer.stop();
      upgradeReconnectMonitor.stop();
    }

    function scheduleUpgradeReconnectPhase(delayMs) {
      upgradeReconnectStageTimer.schedule(Math.max(0, Number(delayMs) || 0));
    }

    function startUpgradeReconnectMonitor() {
      upgradeReconnectMonitor.start();
    }

    function markUpgradeUiAwaitingReconnect() {
      const current = readUpgradeUiSession();
      if (!current || !current.awaitingReconnect) return null;
      return updateUpgradeUiSession({
        phase: 'reconnect',
        detail: tr('updates.detail.awaitReconnect', 'Attente de Reconnection.'),
        reconnectShown: true,
        reconnectProgress: Math.max(5, Math.min(95, Number(current.reconnectProgress) || 0))
      });
    }

    function markUpgradeUiCompletedAfterReceipt(target) {
      const current = readUpgradeUiSession();
      if (!current) return null;
      stopUpgradeReconnectFlow();
      return updateUpgradeUiSession({
        phase: 'done',
        target: target || current.target,
        detail: tr('updates.detail.done', 'Mise à jour terminée.'),
        backendProgress: 100,
        awaitingReconnect: false,
        reconnectShown: true,
        reconnectProgress: 100,
        failedStep: ''
      });
    }

    function incrementUpgradeReconnectProgress() {
      const current = readUpgradeUiSession();
      if (!current || !current.awaitingReconnect) return null;
      const nextProgress = Math.max(5, Math.min(95, (Number(current.reconnectProgress) || 0) + 12));
      return updateUpgradeUiSession({
        phase: 'reconnect',
        detail: tr('updates.detail.awaitReconnect', 'Attente de Reconnection.'),
        reconnectShown: true,
        reconnectProgress: nextProgress
      });
    }

    function enterUpgradeReconnectPhase() {
      const current = readUpgradeUiSession();
      if (!current || !current.awaitingReconnect) return null;
      markUpgradeUiAwaitingReconnect();
      startUpgradeReconnectMonitor();
      return readUpgradeUiSession();
    }

    async function fetchUpgradeReconnectHeartbeat() {
      const supportsAbort = typeof AbortController === 'function';
      const controller = supportsAbort ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => {
            try {
              controller.abort();
            } catch (err) {
            }
          }, upgradeReconnectFetchTimeoutMs)
        : null;
      try {
        return await fetchOkJson('/api/fwupdate/status', {
          cache: 'no-store',
          signal: controller ? controller.signal : undefined
        }, 'état de mise à jour indisponible');
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    async function probeUpgradeReconnect() {
      const current = readUpgradeUiSession();
      if (!current || !current.awaitingReconnect) {
        stopUpgradeReconnectFlow();
        return;
      }
      try {
        updateUpgradeView(await fetchUpgradeReconnectHeartbeat());
      } catch (err) {
        incrementUpgradeReconnectProgress();
      }
    }

    function resumeUpgradeReconnectFlow() {
      const current = readUpgradeUiSession();
      if (!current || !current.awaitingReconnect) return;
      if (current.reconnectShown || current.phase === 'reconnect') {
        startUpgradeReconnectMonitor();
        return;
      }
      scheduleUpgradeReconnectPhase(700);
    }

    function localReleaseOverallProgress(current, target, progress) {
      const filesystemTotal = Number(current && current.releaseFilesystemTotal) || 0;
      const firmwareTotal = Number(current && current.releaseFirmwareTotal) || 0;
      const total = filesystemTotal + firmwareTotal;
      const percent = Math.max(0, Math.min(100, Number(progress) || 0));
      if (total <= 0) return percent;
      if (String(target || '').trim().toLowerCase() === 'spiffs') {
        return Math.round((percent / 100) * filesystemTotal / total * 100);
      }
      return Math.round((filesystemTotal + (percent / 100) * firmwareTotal) / total * 100);
    }

    function updateUpgradeView(data) {
      if (!data || data.ok !== true) return;
      const current = readUpgradeUiSession();
      const state = String(data.state || 'idle');
      const target = String(data.target || (current && current.target) || '').trim().toLowerCase();
      const progress = Math.max(0, Math.min(100, Number(data.progress) || 0));
      const msg = String(data.msg || '').trim();
      const operationId = Number(data.operation_id) > 0 ? Number(data.operation_id) : 0;
      const bootId = Number(data.boot_id) > 0 ? Number(data.boot_id) : 0;
      const currentOperationId = Number(current && current.operationId) > 0
        ? Number(current.operationId)
        : 0;
      const receipt = data.last_operation && typeof data.last_operation === 'object'
        ? data.last_operation
        : null;
      const receiptOperationId = Number(receipt && receipt.operation_id) > 0
        ? Number(receipt.operation_id)
        : 0;
      const receiptMatches = currentOperationId > 0 && receiptOperationId === currentOperationId;
      const receiptResult = receiptMatches ? String(receipt.result || '') : '';

      if (receiptResult === 'succeeded') {
        markUpgradeUiCompletedAfterReceipt(String(receipt.target || target));
        return;
      }
      if (receiptResult === 'failed' || receiptResult === 'interrupted') {
        stopUpgradeReconnectFlow();
        updateUpgradeUiSession({
          phase: 'error',
          target: String(receipt.target || target),
          detail: receiptResult === 'interrupted'
            ? tr('updates.err.interrupted', 'La mise à jour a été interrompue avant sa finalisation.')
            : normalizeUpgradeHttpErrorMessage(msg, tr('updates.err.updateGeneric', 'Erreur de mise à jour.')),
          backendProgress: progress,
          awaitingReconnect: false,
          reconnectShown: false,
          reconnectProgress: 0,
          failedStep: current && current.phase && current.phase !== 'idle' ? current.phase : 'flash',
          bootId: bootId
        });
        return;
      }

      if (currentOperationId > 0 && operationId > 0 && operationId !== currentOperationId) {
        return;
      }

      if (upgradeUiStatusMuted) {
        if (state !== 'idle' && state !== 'done' && state !== 'error') return;
        upgradeUiStatusMuted = false;
      }

      const isLocalRelease = String(current && current.target || '').trim().toLowerCase() === 'release';
      if (isLocalRelease && !(current && current.awaitingReconnect)
          && (state === 'queued' || state === 'downloading' || state === 'flashing' || state === 'done')) {
        stopUpgradeReconnectFlow();
        updateUpgradeUiSession({
          phase: state === 'queued' ? 'target' : 'flash',
          target: 'release',
          detail: state === 'queued'
            ? tr('updates.detail.targetSelected', 'Sélection de la cible {target}.')
              .replace('{target}', upgradeTargetLabel('release'))
            : tr('updates.phase.flash', 'Mise à jour') + (state === 'done' ? '…' : '.'),
          backendProgress: localReleaseOverallProgress(current, target, progress),
          awaitingReconnect: false,
          reconnectShown: false,
          reconnectProgress: 0,
          operationId: operationId || currentOperationId,
          bootId: bootId,
          failedStep: ''
        });
        return;
      }

      if (state === 'idle') {
        if (currentOperationId > 0 && current && current.phase !== 'done' && current.phase !== 'error') {
          stopUpgradeReconnectFlow();
          updateUpgradeUiSession({
            phase: 'error',
            detail: tr('updates.err.resultUnavailable', 'Le résultat de la mise à jour n’est pas disponible après reconnexion.'),
            awaitingReconnect: false,
            reconnectShown: false,
            reconnectProgress: 0,
            failedStep: current.phase || 'reconnect',
            bootId: bootId
          });
        } else if (!current || current.phase === 'idle') {
          clearUpgradeUiSession();
          renderUpgradeJourney({ phase: 'idle', target: '', detail: tr('updates.none', 'Aucune opération en cours.') });
        }
        return;
      }

      if (state === 'queued') {
        stopUpgradeReconnectFlow();
        updateUpgradeUiSession({
          phase: 'target',
          target: target,
          detail: tr('updates.detail.targetSelected', 'Sélection de la cible {target}.')
            .replace('{target}', upgradeTargetLabel(target)),
          backendProgress: progress,
          awaitingReconnect: false,
          reconnectShown: false,
          reconnectProgress: 0,
          operationId: operationId || currentOperationId,
          bootId: bootId,
          failedStep: ''
        });
        return;
      }

      if (state === 'downloading') {
        stopUpgradeReconnectFlow();
        updateUpgradeUiSession({
          phase: 'download',
          target: target,
          detail: 'Connexion au serveur.',
          backendProgress: progress,
          awaitingReconnect: false,
          reconnectShown: false,
          reconnectProgress: 0,
          operationId: operationId || currentOperationId,
          bootId: bootId,
          failedStep: ''
        });
        return;
      }

      if (state === 'flashing') {
        stopUpgradeReconnectFlow();
        updateUpgradeUiSession({
          phase: 'flash',
          target: target,
          detail: 'Mise à jour en cours.',
          backendProgress: progress,
          awaitingReconnect: false,
          reconnectShown: false,
          reconnectProgress: 0,
          operationId: operationId || currentOperationId,
          bootId: bootId,
          failedStep: ''
        });
        return;
      }

      if (state === 'rebooting') {
        stopUpgradeReconnectFlow();
        updateUpgradeUiSession({
          phase: 'reboot',
          target: target,
          detail: 'Redémarrage.',
          backendProgress: 100,
          awaitingReconnect: true,
          reconnectShown: false,
          reconnectProgress: 0,
          operationId: operationId || currentOperationId,
          bootId: bootId,
          failedStep: ''
        });
        scheduleUpgradeReconnectPhase(900);
        return;
      }

      if (state === 'done') {
        if (upgradeUsesReconnect(target)) {
          stopUpgradeReconnectFlow();
          updateUpgradeUiSession({
            phase: 'reboot',
            target: target,
            detail: tr('updates.phase.reboot', 'Redémarrage') + '.',
            backendProgress: 100,
            awaitingReconnect: true,
            reconnectShown: false,
            reconnectProgress: 0,
            operationId: operationId || currentOperationId,
            bootId: bootId,
            failedStep: ''
          });
          scheduleUpgradeReconnectPhase(900);
        } else {
          stopUpgradeReconnectFlow();
          updateUpgradeUiSession({
            phase: 'done',
            target: target,
            detail: tr('updates.detail.done', 'Mise à jour terminée.'),
            backendProgress: 100,
            awaitingReconnect: false,
            reconnectShown: true,
            reconnectProgress: 100,
            operationId: operationId || currentOperationId,
            bootId: bootId,
            failedStep: ''
          });
        }
        return;
      }

      if (state === 'error') {
        stopUpgradeReconnectFlow();
        updateUpgradeUiSession({
          phase: 'error',
          target: target,
          detail: normalizeUpgradeHttpErrorMessage(msg, tr('updates.err.updateGeneric', 'Erreur de mise à jour.')),
          backendProgress: progress,
          awaitingReconnect: false,
          reconnectShown: false,
          reconnectProgress: 0,
          operationId: operationId || currentOperationId,
          bootId: bootId,
          failedStep: current && current.phase && current.phase !== 'idle' ? current.phase : 'flash'
        });
      }
    }

    function normalizeFirmwareVersionForCompare(value) {
      return String(value || '').trim().split('+')[0].replace(/^v/i, '');
    }

    function compareFirmwareVersions(a, b) {
      const left = normalizeFirmwareVersionForCompare(a).split(/[.-]/).map((part) => Number.parseInt(part, 10));
      const right = normalizeFirmwareVersionForCompare(b).split(/[.-]/).map((part) => Number.parseInt(part, 10));
      const len = Math.max(left.length, right.length);
      for (let i = 0; i < len; ++i) {
        const av = Number.isFinite(left[i]) ? left[i] : 0;
        const bv = Number.isFinite(right[i]) ? right[i] : 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
      }
      return 0;
    }

    function manifestArtifactList(manifest, key) {
      if (!manifest || typeof manifest !== 'object') return [];
      const artifacts = (manifest.artifacts && typeof manifest.artifacts === 'object') ? manifest.artifacts : manifest;
      const artifact = artifacts[key];
      if (Array.isArray(artifact)) {
        return artifact.filter((entry) => entry && typeof entry === 'object');
      }
      if (artifact && typeof artifact === 'object' && Array.isArray(artifact.versions)) {
        return artifact.versions
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => Object.assign({}, artifact, entry, { versions: undefined }));
      }
      if (artifact && typeof artifact === 'object' && (artifact.version || artifact.path || artifact.url)) {
        return [artifact];
      }
      if (artifact && typeof artifact === 'object') {
        return Object.keys(artifact)
          .map((version) => {
            const entry = artifact[version];
            return entry && typeof entry === 'object' ? Object.assign({ version: version }, entry) : null;
          })
          .filter(Boolean);
      }
      return [];
    }

    function manifestBaseUrl(manifestUrl) {
      const url = String(manifestUrl || '').trim();
      const idx = url.lastIndexOf('/');
      return idx >= 0 ? url.slice(0, idx + 1) : '';
    }

    function joinManifestArtifactUrl(baseUrl, artifact) {
      if (!artifact || typeof artifact !== 'object') return '';
      const raw = String(artifact.url || artifact.path || '').trim();
      if (!raw) return '';
      if (/^https?:\/\//i.test(raw)) return raw;
      return String(baseUrl || '') + raw.replace(/^\/+/, '');
    }

    function formatManifestBuildDate(artifact) {
      if (!artifact || typeof artifact !== 'object') return '';
      return String(artifact.build_date || artifact.built_at || artifact.date || '').trim();
    }

    function endpointForUpgradeTarget(target) {
      const key = String(target || '').trim().toLowerCase();
      if (key === 'flowios3' || key === 'esp32s3') return '/fwupdate/waveshare';
      if (key === 'waveshare') return '/fwupdate/waveshare';
      if (key === 'spiffs') return '/fwupdate/spiffs';
      if (key === 'nextion') return '/fwupdate/nextion';
      return '';
    }

    function manifestTargetDef(key) {
      return upgradeTargetDefs[String(key || '').trim().toLowerCase()] || null;
    }

    function manifestCategoryVisibleForProfile(category) {
      const key = String(category || '').trim().toLowerCase();
      if (!key) return false;
      if (isSupervisorProfile()) {
        return key === 'flowios3' || key === 'esp32s3' || key === 'waveshare'
          || key === 'spiffs' || key === 'flowios3-spiffs' || key === 'esp32s3-spiffs' || key === 'waveshare-spiffs'
          || key === 'nextion';
      }
      if (isWaveshareProfile()) {
        return key === 'flowios3' || key === 'esp32s3' || key === 'waveshare'
          || key === 'spiffs' || key === 'flowios3-spiffs' || key === 'esp32s3-spiffs' || key === 'waveshare-spiffs'
          || key === 'nextion';
      }
      if (isFlowIOProfile()) {
        return key === 'flowio';
      }
      return true;
    }

    function resolveArtifactTarget(category, artifact) {
      const explicit = String(artifact && (artifact.target || artifact.update_target) ? (artifact.target || artifact.update_target) : '').trim().toLowerCase();
      if (explicit) return explicit;
      const def = manifestTargetDef(category);
      return def && def.target ? def.target : String(category || '').trim().toLowerCase();
    }

    function resolveArtifactEndpoint(category, artifact, target) {
      const categoryKey = String(category || '').trim().toLowerCase();
      if (categoryKey === 'flowios3' || categoryKey === 'esp32s3' || categoryKey === 'waveshare') {
        return '/fwupdate/waveshare';
      }
      const explicit = String(artifact && (artifact.route || artifact.endpoint || artifact.update_route) ? (artifact.route || artifact.endpoint || artifact.update_route) : '').trim();
      if (explicit) {
        if (/^\/fwupdate\//.test(explicit)) return explicit;
        if (/^fwupdate\//.test(explicit)) return '/' + explicit;
        return endpointForUpgradeTarget(explicit);
      }
      const def = manifestTargetDef(category);
      return def && def.endpoint ? def.endpoint : endpointForUpgradeTarget(target);
    }

    function formatManifestArtifactTitle(category, artifact) {
      const def = manifestTargetDef(category);
      const title = String(artifact && (artifact.title || artifact.name) ? (artifact.title || artifact.name) : '').trim();
      if (title) return title;
      const label = String(artifact && artifact.label ? artifact.label : '').trim();
      if (label) return label;
      return def && def.label ? def.label : String(category || 'Firmware');
    }

    function manifestArtifactEntries(manifest, manifestUrl) {
      if (!manifest || typeof manifest !== 'object') return [];
      const baseUrl = manifestBaseUrl(manifestUrl);
      const artifacts = (manifest.artifacts && typeof manifest.artifacts === 'object') ? manifest.artifacts : manifest;
      return Object.keys(artifacts)
        .reduce((entries, category) => {
          if (!manifestCategoryVisibleForProfile(category)) return entries;
          const def = manifestTargetDef(category);
          const orderBase = def && Number.isFinite(def.order) ? def.order : 1000;
          manifestArtifactList(manifest, category)
            .filter((artifact) => joinManifestArtifactUrl(baseUrl, artifact))
            .sort((a, b) => compareFirmwareVersions(String(b.version || ''), String(a.version || '')))
            .forEach((artifact, index) => {
              const target = resolveArtifactTarget(category, artifact);
              entries.push({
                category: category,
                artifact: artifact,
                title: formatManifestArtifactTitle(category, artifact),
                version: String(artifact.version || '').trim() || 'version inconnue',
                buildDate: formatManifestBuildDate(artifact) || '-',
                notes: String(artifact.notes || artifact.release_notes || '').trim() || 'Notes de version indisponibles.',
                url: joinManifestArtifactUrl(baseUrl, artifact),
                target: target,
                endpoint: resolveArtifactEndpoint(category, artifact, target),
                order: orderBase + index / 100
              });
            });
          return entries;
        }, [])
        .sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return compareFirmwareVersions(String(b.version || ''), String(a.version || ''));
        });
    }

    function setUpgradeCardsEmpty(text) {
      renderUpgradeCatalog();
      if (text) setUpgradeMessage(text);
    }

    function setUpgradeCardsError(detail) {
      renderUpgradeCatalog({ error: detail || tr('updates.err.checkGeneric', 'Échec de la vérification.') });
    }

    function splitUpgradeVersionStamp(rawVersion, fallbackBuildDate) {
      const raw = String(rawVersion || '').trim();
      const plusIndex = raw.indexOf('+');
      const main = (plusIndex >= 0 ? raw.slice(0, plusIndex) : raw).trim();
      const plusBuild = plusIndex >= 0 ? raw.slice(plusIndex + 1).trim() : '';
      return {
        version: main || '-',
        build: formatUpgradeBuildStamp(plusBuild || fallbackBuildDate || '')
      };
    }

    function formatUpgradeBuildStamp(rawValue) {
      const raw = String(rawValue || '').trim();
      if (!raw || raw === '-') return '-';
      const compact = raw.match(/^(\d{4})(\d{2})(\d{2})[._-]?(\d{2})(\d{2})(\d{2})$/);
      if (compact) {
        return compact[3] + '/' + compact[2] + '/' + compact[1] + ' ' + compact[4] + ':' + compact[5] + ':' + compact[6];
      }
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) {
        const d = new Date(parsed);
        return d.toLocaleDateString(currentWebLocaleTag()) + ' ' + d.toLocaleTimeString(currentWebLocaleTag(), {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      }
      return raw;
    }

    function upgradeBuildStampValue(rawValue) {
      const raw = String(rawValue || '').trim();
      if (!raw || raw === '-') return 0;
      const compact = raw.match(/^(\d{4})(\d{2})(\d{2})[._-]?(\d{2})(\d{2})(\d{2})$/);
      if (compact) {
        return Number(compact[1] + compact[2] + compact[3] + compact[4] + compact[5] + compact[6]);
      }
      const parsed = Date.parse(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function compareUpgradeArtifacts(a, b) {
      const versionCompare = compareFirmwareVersions(String(a && a.version ? a.version : ''), String(b && b.version ? b.version : ''));
      if (versionCompare !== 0) return versionCompare;
      const aStamp = splitUpgradeVersionStamp(a && a.version, formatManifestBuildDate(a)).build;
      const bStamp = splitUpgradeVersionStamp(b && b.version, formatManifestBuildDate(b)).build;
      const dateCompare = upgradeBuildStampValue(aStamp) - upgradeBuildStampValue(bStamp);
      if (dateCompare > 0) return 1;
      if (dateCompare < 0) return -1;
      return 0;
    }

    function buildUpgradeEntry(category, artifact, baseUrl) {
      const target = resolveArtifactTarget(category, artifact);
      const split = splitUpgradeVersionStamp(artifact.version, formatManifestBuildDate(artifact));
      return {
        category: category,
        artifact: artifact,
        title: formatManifestArtifactTitle(category, artifact),
        version: split.version,
        buildDate: split.build,
        url: joinManifestArtifactUrl(baseUrl, artifact),
        target: target,
        endpoint: resolveArtifactEndpoint(category, artifact, target)
      };
    }

    function upgradeManifestKeysForComponent(componentKey) {
      const key = String(componentKey || '').trim().toLowerCase();
      if (key === 'flowio') {
        return ['flowios3', 'waveshare', 'esp32s3'];
      }
      if (key === 'spiffs') {
        return ['spiffs', 'flowios3-spiffs', 'esp32s3-spiffs', 'waveshare-spiffs'];
      }
      return [key];
    }

    function latestUpgradeEntryForComponent(componentKey, manifest, manifestUrl) {
      if (!manifest || typeof manifest !== 'object') return null;
      const baseUrl = manifestBaseUrl(manifestUrl);
      const entries = [];
      const nextionSelection = componentKey === 'nextion' && upgradeManifestState
        && upgradeManifestState.nextion && typeof upgradeManifestState.nextion === 'object'
        ? upgradeManifestState.nextion
        : null;
      const selectedNextionPath = nextionSelection && nextionSelection.artifact_selected === true
        ? String(nextionSelection.artifact_path || '').trim()
        : '';
      upgradeManifestKeysForComponent(componentKey).forEach((category) => {
        manifestArtifactList(manifest, category)
          .filter((artifact) => joinManifestArtifactUrl(baseUrl, artifact))
          .filter((artifact) => componentKey !== 'nextion'
            || (!!selectedNextionPath && String(artifact.path || '').trim() === selectedNextionPath))
          .forEach((artifact) => {
            entries.push(buildUpgradeEntry(category, artifact, baseUrl));
          });
      });
      if (!entries.length) return null;
      entries.sort((a, b) => compareUpgradeArtifacts(b.artifact, a.artifact));
      return entries[0];
    }

    function nextionRecoveryEntries(manifest, manifestUrl) {
      if (!manifest || typeof manifest !== 'object') return [];
      const baseUrl = manifestBaseUrl(manifestUrl);
      const latestByCompatibility = new Map();
      manifestArtifactList(manifest, 'nextion')
        .filter((artifact) => String(artifact.display_compatibility || '').trim())
        .filter((artifact) => joinManifestArtifactUrl(baseUrl, artifact))
        .forEach((artifact) => {
          const entry = buildUpgradeEntry('nextion', artifact, baseUrl);
          if (entry.target !== 'nextion' || entry.endpoint !== '/fwupdate/nextion') return;
          entry.compatibility = String(artifact.display_compatibility || '').trim();
          entry.recovery = true;
          const previous = latestByCompatibility.get(entry.compatibility);
          if (!previous || compareUpgradeArtifacts(entry.artifact, previous.artifact) > 0) {
            latestByCompatibility.set(entry.compatibility, entry);
          }
        });
      return Array.from(latestByCompatibility.values())
        .sort((left, right) => left.compatibility.localeCompare(right.compatibility));
    }

    function formatDetectedNextionVersion(rawValue) {
      const raw = String(rawValue || '').trim();
      if (!raw || raw === '0') return '-';
      if (raw.indexOf('.') >= 0) return raw;
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) return raw;
      if (n >= 100) {
        return Math.floor(n / 100) + '.' + (Math.floor(n / 10) % 10) + '.' + (n % 10);
      }
      return raw;
    }

    function currentUpgradeVersionForComponent(componentKey) {
      const key = String(componentKey || '').trim().toLowerCase();
      if (key === 'nextion') {
        return splitUpgradeVersionStamp(formatDetectedNextionVersion(webDeviceMeta.nextionVersion), '');
      }
      const supervisor = String(webDeviceMeta.firmwareVersion || '').trim();
      const flow = String(window.__flowIoFirmwareVersion || '').trim();
      const firmware = supervisor && supervisor !== '-' ? supervisor : flow;
      return splitUpgradeVersionStamp(firmware && firmware !== '-' ? firmware : '-', '');
    }

    function buildUpgradeComponentRows() {
      const manifest = upgradeManifestState && upgradeManifestState.manifest;
      const manifestUrl = upgradeManifestState && upgradeManifestState.manifestUrl;
      const hasManifest = !!(manifest && typeof manifest === 'object');
      return upgradeComponentDefs.map((def) => {
        const current = currentUpgradeVersionForComponent(def.key);
        const latest = latestUpgradeEntryForComponent(def.key, manifest, manifestUrl);
        const recoveryRequired = def.key === 'nextion' && !webDeviceMeta.nextionDetected;
        const recoveryEntries = recoveryRequired
          ? nextionRecoveryEntries(manifest, manifestUrl)
          : [];
        const available = latest
          ? { version: latest.version, build: latest.buildDate }
          : { version: '-', build: '-' };
        const nextionUnavailable = hasManifest && def.key === 'nextion' && webDeviceMeta.nextionDetected && !latest;
        const comparableCurrent = current.version && current.version !== '-';
        const comparableAvailable = available.version && available.version !== '-';
        const updateAvailable = !recoveryRequired && !nextionUnavailable
          && comparableAvailable
          && (!comparableCurrent || compareFirmwareVersions(available.version, current.version) > 0);
        const unavailableMessage = webDeviceMeta.nextionDetected
          ? tr('updates.nextion.noCompatibleArtifact', 'Aucun firmware Nextion compatible')
          : tr('updates.nextion.notDetected', 'Nextion non détecté');
        const statusMessage = recoveryRequired
          ? tr('updates.nextion.manualSelection', 'Écran non détecté : sélectionnez son modèle')
          : (nextionUnavailable ? unavailableMessage : '');
        const statusKnown = recoveryRequired || hasManifest;
        return Object.assign({}, def, {
          subtitle: def.key === 'nextion'
            ? (webDeviceMeta.nextionCompatibility || def.subtitle)
            : def.subtitle,
          current: current,
          available: available,
          updateAvailable: updateAvailable,
          statusKnown: statusKnown,
          // Nextion remains actionable in recovery mode. A compatible model is
          // selected explicitly instead of disabling the whole row.
          unavailable: false,
          unavailableMessage: '',
          statusMessage: statusMessage,
          recoveryRequired: recoveryRequired,
          recoveryEntries: recoveryEntries,
          entry: recoveryRequired ? null : latest
        });
      });
    }

    function appendUpgradeVersionCell(parent, versionInfo) {
      const wrap = document.createElement('div');
      wrap.className = 'update-version-stack';
      const version = document.createElement('strong');
      version.textContent = (versionInfo && versionInfo.version) || '-';
      const build = document.createElement('span');
      build.textContent = (versionInfo && versionInfo.build) || '-';
      wrap.appendChild(version);
      wrap.appendChild(build);
      parent.appendChild(wrap);
    }

    function createUpgradeComponentBadge(row, sizeClass) {
      const badge = document.createElement('span');
      badge.className = 'update-component-badge update-component-' + row.tone + (sizeClass ? ' ' + sizeClass : '');
      const icon = document.createElement('span');
      icon.className = 'ui-msr';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = row.icon;
      badge.appendChild(icon);
      return badge;
    }

    function upgradeStatusLabel(row) {
      if (!row || !row.statusKnown) return '';
      if (row.statusMessage) return row.statusMessage;
      if (row.unavailable) return row.unavailableMessage;
      if (row.updateAvailable) return tr('updates.status.available', 'Mise à jour disponible');
      return tr('updates.status.current', 'À jour');
    }

    function createUpgradeStatusBadge(row) {
      if (!row || !row.statusKnown) return null;
      const badge = document.createElement('span');
      badge.className = 'update-status-badge ' + (row.statusMessage
        ? 'is-unavailable'
        : (row.unavailable
        ? 'is-unavailable'
        : (row.updateAvailable ? 'is-available' : 'is-current')));
      badge.textContent = upgradeStatusLabel(row);
      return badge;
    }

    function createUpgradeActionControl(row) {
      const control = document.createElement('div');
      control.className = 'update-action-control';
      let selectedEntry = row && row.entry;

      if (row && row.recoveryRequired && row.recoveryEntries.length > 0) {
        const select = document.createElement('select');
        select.className = 'update-nextion-model-select';
        select.setAttribute('aria-label', tr('updates.nextion.selectModel', 'Sélectionner le modèle Nextion'));
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = tr('updates.nextion.selectModel', 'Sélectionner le modèle Nextion');
        select.appendChild(placeholder);
        row.recoveryEntries.forEach((entry, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          option.textContent = entry.compatibility + ' · v' + entry.version;
          select.appendChild(option);
        });
        select.addEventListener('change', () => {
          const index = Number.parseInt(select.value, 10);
          selectedEntry = Number.isInteger(index) ? row.recoveryEntries[index] : null;
        });
        control.appendChild(select);
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'update-action-btn';
      const icon = document.createElement('span');
      icon.className = 'ui-msr';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = 'system_update_alt';
      const label = document.createElement('span');
      label.textContent = tr('updates.updateButton', 'Mettre à jour');
      button.appendChild(icon);
      button.appendChild(label);
      const isNextion = row && row.key === 'nextion';
      button.disabled = !isNextion && (!!(row && row.unavailable) || !(selectedEntry && selectedEntry.endpoint && selectedEntry.url));
      button.title = tr('updates.updateButton', 'Mettre à jour');
      bindClickAction(button, () => {
        if (!selectedEntry || !selectedEntry.endpoint || !selectedEntry.url) {
          if (row && row.recoveryRequired && row.recoveryEntries.length > 0) {
            setUpgradeMessage(tr('updates.nextion.selectModelRequired', 'Sélectionnez le modèle Nextion avant de continuer.'));
            const select = control.querySelector('select');
            if (select) select.focus();
            return;
          }
          return checkFirmwareUpdates();
        }
        if (!confirmUpgradeLaunch(selectedEntry)) return;
        return startUpgrade(selectedEntry.target, selectedEntry.url, selectedEntry.endpoint);
      });
      control.appendChild(button);
      return control;
    }

    function renderUpgradeTable(rows) {
      if (!upgradeTableBody) return;
      upgradeTableBody.innerHTML = '';
      rows.forEach((row) => {
        const trEl = document.createElement('tr');
        if (row.unavailable) {
          trEl.className = 'is-disabled';
        }

        const componentCell = document.createElement('td');
        const component = document.createElement('div');
        component.className = 'update-component-cell';
        component.appendChild(createUpgradeComponentBadge(row, ''));
        const copy = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = row.title;
        const sub = document.createElement('span');
        sub.textContent = '(' + row.subtitle + ')';
        copy.appendChild(title);
        copy.appendChild(sub);
        component.appendChild(copy);
        componentCell.appendChild(component);
        trEl.appendChild(componentCell);

        const currentCell = document.createElement('td');
        appendUpgradeVersionCell(currentCell, row.current);
        trEl.appendChild(currentCell);

        const availableCell = document.createElement('td');
        appendUpgradeVersionCell(availableCell, row.available);
        trEl.appendChild(availableCell);

        const statusCell = document.createElement('td');
        const statusBadge = createUpgradeStatusBadge(row);
        if (statusBadge) statusCell.appendChild(statusBadge);
        trEl.appendChild(statusCell);

        const actionCell = document.createElement('td');
        actionCell.appendChild(createUpgradeActionControl(row));
        trEl.appendChild(actionCell);

        upgradeTableBody.appendChild(trEl);
      });
    }

    function renderUpgradeCatalog(options) {
      const rows = buildUpgradeComponentRows();
      renderUpgradeTable(rows);
      if (options && options.error) {
        setUpgradeMessage(tr('updates.err.checkGeneric', 'Échec de la vérification.') + ' : ' + options.error);
      }
    }

    function resetUpgradeManifestSelections(text) {
      upgradeManifestState = { manifest: null, manifestUrl: '', baseUrl: '', nextion: null };
      setUpgradeCardsEmpty(text || tr('updates.empty', 'Cliquez sur « Vérifier les mises à jour ».'));
    }

    function confirmUpgradeLaunch(entry) {
      const version = String(entry && entry.version ? entry.version : 'x.x.x').trim() || 'x.x.x';
      const target = upgradeTargetLabel(entry && entry.target ? entry.target : '');
      if (entry && entry.recovery) {
        return confirm(
          tr('updates.nextion.confirmRecovery', 'Écran non détecté. Confirmer la mise à jour du modèle {model} vers la version {version} ? Vérifiez soigneusement le modèle sélectionné.')
            .replace('{model}', String(entry.compatibility || 'Nextion'))
            .replace('{version}', version)
        );
      }
      return confirm(
        tr('updates.confirmLaunch', 'Confirmer la mise à jour de {target} vers la version {version} ?')
          .replace('{target}', target)
          .replace('{version}', version)
      );
    }

    function populateUpgradeManifestSelections(data) {
      const manifest = data && data.manifest && typeof data.manifest === 'object' ? data.manifest : null;
      const manifestUrl = String(data && data.manifest_url ? data.manifest_url : '').trim();
      const nextion = data && data.nextion && typeof data.nextion === 'object' ? data.nextion : null;
      upgradeManifestState = {
        manifest: manifest,
        manifestUrl: manifestUrl,
        baseUrl: manifestBaseUrl(manifestUrl),
        nextion: nextion
      };
      if (nextion) {
        webDeviceMeta.nextionDetected = nextion.display_detected === true;
        webDeviceMeta.nextionModel = String(nextion.model || '').trim();
        webDeviceMeta.nextionCompatibility = String(nextion.compatibility || '').trim();
      }
      renderUpgradeCatalog();
    }

    function describeManifestUpdates(data) {
      const manifest = data && data.manifest && typeof data.manifest === 'object' ? data.manifest : null;
      if (!manifest) return 'Manifest indisponible.';
      const rows = buildUpgradeComponentRows();
      const available = rows
        .filter((row) => row.updateAvailable)
        .map((row) => row.title + ' ' + row.current.version + ' -> ' + row.available.version);
      const listed = rows
        .filter((row) => row.available.version && row.available.version !== '-')
        .map((row) => row.title + ' ' + row.available.version);
      if (available.length > 0) {
        return 'Mise(s) à jour disponible(s) : ' + available.join(', ') + '.';
      }
      if (listed.length > 0) {
        return 'Manifest vérifié. Versions disponibles : ' + listed.join(', ') + '.';
      }
      return 'Manifest vérifié, aucun firmware listé.';
    }

    async function checkFirmwareUpdates() {
      if (checkUpdatesBtn) {
        checkUpdatesBtn.disabled = true;
        checkUpdatesBtn.classList.add('is-pending');
      }
      try {
        setUpgradeCardsEmpty(tr('updates.checking', 'Vérification du manifest...'));
        setUpgradeMessage(tr('updates.checking', 'Vérification du manifest...'));
        const started = await fetchOkJson(
          '/api/fwupdate/check',
          { method: 'POST', cache: 'no-store' },
          'échec lancement vérification'
        );
        const requestId = Number(started && started.request_id);
        if (!Number.isFinite(requestId) || requestId <= 0) {
          throw new Error('identifiant de vérification invalide');
        }

        const maxPollAttempts = 215;
        let data = null;
        for (let attempt = 0; attempt < maxPollAttempts; ++attempt) {
          data = await fetchOkJson(
            '/api/fwupdate/check?request_id=' + encodeURIComponent(String(requestId)),
            { cache: 'no-store' },
            'échec vérification'
          );
          if (data && data.state === 'ready') break;
          if (!data || (data.state !== 'queued' && data.state !== 'downloading')) {
            throw new Error('état de vérification inattendu');
          }
          await waitMs(400);
        }
        if (!data || data.state !== 'ready') {
          throw new Error('délai de vérification du manifest dépassé');
        }
        populateUpgradeManifestSelections(data);
        setUpgradeMessage(describeManifestUpdates(data));
      } catch (err) {
        const errMsg = normalizeUpgradeHttpErrorMessage(String(err || ''), tr('updates.err.checkGeneric', 'Échec de la vérification.'));
        setUpgradeCardsError(errMsg);
        setUpgradeMessage(tr('updates.err.checkGeneric', 'Échec de la vérification.') + ' : ' + errMsg);
      } finally {
        if (checkUpdatesBtn) {
          checkUpdatesBtn.disabled = false;
          checkUpdatesBtn.classList.remove('is-pending');
        }
      }
    }

    async function refreshUpgradeStatus() {
      try {
        updateUpgradeView(await fetchOkJson('/api/fwupdate/status', { cache: 'no-store' }, 'échec lecture état'));
      } catch (err) {
        const current = readUpgradeUiSession();
        const phase = String(current && current.phase ? current.phase : 'idle');
        if (current && (current.awaitingReconnect || phase === 'target' || phase === 'download' || phase === 'flash' || phase === 'reboot' || phase === 'reconnect')) {
          if (!current.awaitingReconnect) {
            updateUpgradeUiSession({
              phase: 'reconnect',
              detail: tr('updates.detail.awaitReconnect', 'Attente de Reconnection.'),
              awaitingReconnect: true,
              reconnectShown: true,
              reconnectProgress: Math.max(5, Number(current.reconnectProgress) || 0)
            });
          }
          enterUpgradeReconnectPhase();
          return;
        }
        setUpgradeMessage('Échec de lecture de l\'état : ' + err);
      }
    }

    async function startUpgrade(target, url, endpoint) {
      try {
        startUpgradeUiSession(target);
        startUpgradeStatusPolling(true);
        const selectedUrl = String(url || '').trim();
        if (!selectedUrl) {
          throw new Error('aucune image sélectionnée, lancez Vérifier');
        }
        const route = String(endpoint || endpointForUpgradeTarget(target)).trim();
        if (!route) {
          throw new Error('route de mise à jour indisponible');
        }
        const started = await fetchOkJson(route, createFormPostOptions({ url: selectedUrl }), 'échec démarrage');
        const operationId = Number(started && started.operation_id);
        if (!Number.isFinite(operationId) || operationId <= 0) {
          throw new Error('identifiant d’opération invalide');
        }
        updateUpgradeUiSession({ operationId: operationId });
        await refreshUpgradeStatus();
      } catch (err) {
        stopUpgradeReconnectFlow();
        updateUpgradeUiSession({
          phase: 'error',
          target: target,
          detail: 'Échec de la mise à jour : ' + err,
          backendProgress: 0,
          awaitingReconnect: false,
          reconnectShown: false,
          reconnectProgress: 0,
          failedStep: 'target'
        });
        setUpgradeMessage('Échec de la mise à jour : ' + err);
      }
    }

    async function readStoredReleaseZip(file) {
      const decoder = new TextDecoder('utf-8');
      const entries = new Map();
      let offset = 0;
      while (offset + 4 <= file.size) {
        const prefix = new DataView(await file.slice(offset, offset + 4).arrayBuffer());
        const signature = prefix.getUint32(0, true);
        if (signature === 0x02014b50 || signature === 0x06054b50) break;
        if (signature !== 0x04034b50 || offset + 30 > file.size) {
          throw new Error('structure ZIP invalide');
        }
        const header = new DataView(await file.slice(offset, offset + 30).arrayBuffer());
        const flags = header.getUint16(6, true);
        const method = header.getUint16(8, true);
        const compressedSize = header.getUint32(18, true);
        const uncompressedSize = header.getUint32(22, true);
        const nameLength = header.getUint16(26, true);
        const extraLength = header.getUint16(28, true);
        if ((flags & 0x0009) !== 0 || method !== 0 || compressedSize !== uncompressedSize) {
          throw new Error('le package ZIP doit être un package Flow.IO non compressé');
        }
        const nameStart = offset + 30;
        const dataStart = nameStart + nameLength + extraLength;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > file.size) throw new Error('entrée ZIP tronquée');
        const name = decoder.decode(await file.slice(nameStart, nameStart + nameLength).arrayBuffer());
        if (!name || entries.has(name)) throw new Error('entrée ZIP invalide ou dupliquée');
        entries.set(name, file.slice(dataStart, dataEnd, 'application/octet-stream'));
        offset = dataEnd;
      }
      const required = ['manifest.json', 'firmware.bin', 'spiffs.bin'];
      if (entries.size !== required.length || required.some((name) => !entries.has(name))) {
        throw new Error('le ZIP doit contenir uniquement manifest.json, firmware.bin et spiffs.bin');
      }
      return entries;
    }

    function uploadReleaseBlob(url, blob, onProgress) {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('POST', url, true);
        request.setRequestHeader('Content-Type', 'application/octet-stream');
        request.upload.onprogress = (event) => {
          if (event.lengthComputable && typeof onProgress === 'function') {
            onProgress(Math.round((event.loaded * 100) / event.total));
          }
        };
        request.onerror = () => reject(new Error('connexion interrompue pendant l’upload'));
        request.onload = () => {
          let payload = null;
          try { payload = request.responseText ? JSON.parse(request.responseText) : null; } catch (_) {}
          if (request.status < 200 || request.status >= 300 || (payload && payload.ok === false)) {
            const detail = payload && payload.err ? (payload.err.msg || payload.err.code) : request.responseText;
            reject(new Error(detail || 'upload refusé'));
            return;
          }
          resolve(payload || { ok: true });
        };
        request.send(blob);
      });
    }

    async function installLocalRelease(file) {
      let transactionId = 0;
      if (localReleaseSelectBtn) localReleaseSelectBtn.disabled = true;
      try {
        const entries = await readStoredReleaseZip(file);
        const manifestText = await entries.get('manifest.json').text();
        const manifest = JSON.parse(manifestText);
        const firmware = entries.get('firmware.bin');
        const filesystem = entries.get('spiffs.bin');
        if (!manifest || manifest.format !== 1 || manifest.product !== 'Flow.IO' ||
            manifest.hardware !== 'WaveshareESP32S3' || !manifest.version ||
            !manifest.firmware || !manifest.filesystem ||
            manifest.firmware.file !== 'firmware.bin' || manifest.filesystem.file !== 'spiffs.bin' ||
            Number(manifest.firmware.size) !== firmware.size ||
            Number(manifest.filesystem.size) !== filesystem.size) {
          throw new Error('manifest de release incompatible');
        }
        const description = 'Flow.IO ' + manifest.version + '\nFirmware : ' + firmware.size +
          ' octets\nFilesystem : ' + filesystem.size + ' octets';
        if (localReleaseSummary) localReleaseSummary.textContent = description.replace(/\n/g, ' · ');
        if (!confirm(description + '\n\nInstaller cette release puis redémarrer ?')) return;

        startUpgradeUiSession('release');
        updateUpgradeUiSession({
          releaseFilesystemTotal: Number(manifest.filesystem && manifest.filesystem.size) || 0,
          releaseFirmwareTotal: Number(manifest.firmware && manifest.firmware.size) || 0
        });
        setUpgradeMessage('Préparation de la release ' + manifest.version + '…');
        const started = await fetchOkJson('/api/upgrade/begin', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: manifestText
        }, 'échec de préparation du package');
        transactionId = Number(started && started.transaction_id);
        if (!Number.isFinite(transactionId) || transactionId <= 0) {
          throw new Error('identifiant de transaction invalide');
        }
        const query = '?transaction_id=' + encodeURIComponent(String(transactionId));
        await uploadReleaseBlob('/api/upgrade/filesystem' + query, filesystem, (progress) => {
          setUpgradeMessage('Installation du filesystem : ' + progress + '%');
        });
        await uploadReleaseBlob('/api/upgrade/firmware' + query, firmware, (progress) => {
          setUpgradeMessage('Installation du firmware : ' + progress + '%');
        });
        await fetchOkJson('/api/upgrade/commit' + query,
                          { method: 'POST', cache: 'no-store' },
                          'échec de validation de la release');
        transactionId = 0;
        updateUpgradeUiSession({
          phase: 'reboot',
          target: 'release',
          detail: 'Release installée. Flow.IO redémarre…',
          backendProgress: 100,
          awaitingReconnect: true
        });
        setUpgradeMessage('Release installée. Flow.IO redémarre…');
        enterUpgradeReconnectPhase();
      } catch (err) {
        if (transactionId > 0) {
          await fetch('/api/upgrade/abort?transaction_id=' + encodeURIComponent(String(transactionId)), {
            method: 'POST', cache: 'no-store'
          }).catch(() => {});
        }
        updateUpgradeUiSession({ phase: 'error', target: 'release', detail: String(err), backendProgress: 0 });
        setUpgradeMessage('Échec du package local : ' + err);
      } finally {
        if (localReleaseSelectBtn) localReleaseSelectBtn.disabled = false;
        if (localReleaseFileInput) localReleaseFileInput.value = '';
      }
    }

    async function onUpgradePageShown() {
      renderUpgradeJourney(readUpgradeUiSession() || { phase: 'idle', target: '', detail: tr('updates.none', 'Aucune opération en cours.') });
      renderUpgradeCatalog();
      resumeUpgradeReconnectFlow();
      await loadWebMeta().catch(() => {});
      await refreshUpgradeStatus();
      if (getActivePageId() === 'page-system') startUpgradeStatusPolling();
    }

    function initUpgradeBindings() {
      bindClickAction(checkUpdatesBtn, () => checkFirmwareUpdates());
      bindClickAction(cancelUpgradeUiBtn, () => cancelUpgradeUiSession());
      bindClickAction(localReleaseSelectBtn, () => {
        if (!localReleaseFileInput) return;
        localReleaseFileInput.value = '';
        localReleaseFileInput.click();
      });
      if (localReleaseFileInput) {
        localReleaseFileInput.addEventListener('change', () => {
          const file = localReleaseFileInput.files && localReleaseFileInput.files[0]
            ? localReleaseFileInput.files[0]
            : null;
          if (file) runAsyncTaskSafely(() => installLocalRelease(file));
        });
      }
    }


    initUpgradeBindings();
    return { show: onUpgradePageShown, resume: resumeUpgradeReconnectFlow, renderCatalog: renderUpgradeCatalog,
      startPolling: startUpgradeStatusPolling, hide: stopUpgradeStatusPolling };
  }
  pages.updates = { create: create };
})(window);
