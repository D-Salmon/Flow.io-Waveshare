(function (global) {
  'use strict';
  var pages = global.FlowWebPages = global.FlowWebPages || {};
  function create({ getSession, createFormPostOptions, fetchJsonResponse, fetchOkJson }) {
    const activityLogList = document.getElementById('activityLogList');
    const activityLogStatus = document.getElementById('activityLogStatus');
    const activityRefreshBtn = document.getElementById('activityRefreshBtn');
    const activityPurgeBtn = document.getElementById('activityPurgeBtn');
    const activityPrevBtn = document.getElementById('activityPrevBtn');
    const activityNextBtn = document.getElementById('activityNextBtn');
    const activityRangeText = document.getElementById('activityRangeText');
    const activityFilterBtns = Array.from(document.querySelectorAll('[data-activity-filter]'));
    const activitySelectVisibleBtn = document.getElementById('activitySelectVisibleBtn');
    const activityPeriodScope = document.getElementById('activityPeriodScope');
    const activityDeleteConfirmation = document.getElementById('activityDeleteConfirmation');
    let activityConfirmationSequences = null;
    let activityShowWholeJournal = true;
    let activityFilter = 'all';
    let activityWindowShiftHours = 0;
    let activityRequestToken = 0;
    let activityAbortController = null;
    let activityLoadedEvents = [];
    const activitySelectedSequences = new Set();
    let activityDeleting = false;
    let activityLoadedStats = null;

    function activityEventDate(ev) {
      const epoch = Number(ev && ev.epoch_s) || 0;
      if (epoch > 0) return new Date(epoch * 1000);
      return null;
    }

    function formatActivityTime(date) {
      if (!date) return '--:--:--';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function formatActivityDay(date) {
      if (!date) return 'Date inconnue';
      const dayText = date.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const dayOffset = Math.round((startOfToday - startOfDay) / 86400000);
      if (dayOffset === 0) return 'Aujourd’hui · ' + dayText;
      if (dayOffset === 1) return 'Hier · ' + dayText;
      return dayText;
    }

    function formatActivityActor(ev) {
      if (ev && ev.actor_kind === 'remote') return 'Remote (MQTT)';
      if (ev && String(ev.actor_kind || '') === 'user' && ev.actor) {
        return 'par ' + String(ev.actor);
      }
      return 'Système';
    }

    function formatActivityRelative(date) {
      if (!date) return 'heure non synchronisée';
      const diffSec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
      if (diffSec < 60) return diffSec <= 3 ? 'Maintenant' : ('Il y a ' + diffSec + ' secondes');
      const diffMin = Math.round(diffSec / 60);
      if (diffMin < 60) return 'Il y a ' + diffMin + ' min';
      const diffHour = Math.round(diffMin / 60);
      if (diffHour < 24) return 'Il y a ' + diffHour + ' h';
      const diffDay = Math.round(diffHour / 24);
      return 'Il y a ' + diffDay + ' j';
    }

    function activityMatchesCategory(ev) {
      if (activityFilter === 'all') return true;
      if (activityFilter === 'poollogic') return ev.domain_name === 'poollogic' || ev.domain_name === 'pooldevice';
      if (activityFilter === 'manual') return ev.source_name === 'manual';
      if (activityFilter === 'safety') return ev.domain_name === 'alarm' || ev.source_name === 'safety' || ev.severity_name === 'warning' || ev.severity_name === 'alarm';
      if (activityFilter === 'system') return ev.domain_name === 'system';
      return true;
    }

    function activityMatchesFilter(ev) {
      if (!activityMatchesCategory(ev)) return false;
      if (activityShowWholeJournal) return true;
      const date = activityEventDate(ev);
      if (date) {
        const end = Date.now() - (activityWindowShiftHours * 3 * 3600000);
        const start = end - (3 * 3600000);
        const ts = date.getTime();
        if (ts < start || ts > end) return false;
      } else if (activityWindowShiftHours !== 0) {
        return false;
      }
      return true;
    }

    function setActivityPeriodScope(showWholeJournal) {
      activityShowWholeJournal = showWholeJournal;
      if (activityPeriodScope) activityPeriodScope.value = showWholeJournal ? 'all' : 'period';
    }

    function updateActivityRangeText() {
      if (!activityRangeText) return;
      if (activityShowWholeJournal) {
        activityRangeText.textContent = 'Toutes les dates du journal conservé';
        return;
      }
      const end = new Date(Date.now() - (activityWindowShiftHours * 3 * 3600000));
      const start = new Date(end.getTime() - (3 * 3600000));
      activityRangeText.textContent =
        start.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' à ' +
        start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' +
        end.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' à ' +
        end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function cancelActivityLogRefresh() {
      activityRequestToken += 1;
      const controller = activityAbortController;
      activityAbortController = null;
      if (controller) controller.abort();
    }

    function updateActivitySelection() {
      const busy = activityDeleting || !!activityAbortController || !!activityConfirmationSequences;
      if (activityPurgeBtn) activityPurgeBtn.disabled = busy || !activitySelectedSequences.size;
      if (activitySelectVisibleBtn) activitySelectVisibleBtn.disabled = busy;
      if (activityRefreshBtn) activityRefreshBtn.disabled = activityDeleting || !!activityConfirmationSequences;
      if (activityPeriodScope) activityPeriodScope.disabled = busy;
      if (activityPrevBtn) activityPrevBtn.disabled = busy || activityShowWholeJournal;
      if (activityNextBtn) activityNextBtn.disabled = busy || activityShowWholeJournal || activityWindowShiftHours === 0;
      activityFilterBtns.forEach(button => { button.disabled = busy; });
      const count = document.getElementById('activitySelectionCount');
      if (count) count.textContent = 'Supprimer la sélection (' + activitySelectedSequences.size + ')';
    }

    function renderActivityLog(events, stats) {
      if (!activityLogList) return;
      activityLogList.innerHTML = '';
      updateActivityRangeText();
      updateActivitySelection();
      const filtered = (Array.isArray(events) ? events : [])
        .filter(activityMatchesFilter)
        .sort((a, b) => {
          const ae = Number(a.epoch_s) || 0;
          const be = Number(b.epoch_s) || 0;
          if (ae !== be) return be - ae;
          return (Number(b.seq) || 0) - (Number(a.seq) || 0);
        });
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'activity-empty';
        empty.textContent = 'Aucune activité pour ce filtre.';
        activityLogList.appendChild(empty);
        if (activityLogStatus) {
          if (stats) {
            activityLogStatus.textContent =
              '0/' + (Number(stats.entries) || 0) +
              ' événement(s)';
          } else {
            activityLogStatus.textContent = 'Aucune activité.';
          }
        }
        return;
      }
      let currentDay = '';
      let currentDayEvents = null;
      filtered.forEach((ev) => {
        const date = activityEventDate(ev);
        const day = formatActivityDay(date);
        if (day !== currentDay) {
          currentDay = day;
          const daySection = document.createElement('section');
          daySection.className = 'activity-day';
          const dayNode = document.createElement('div');
          dayNode.className = 'activity-day-title';
          dayNode.textContent = day;
          currentDayEvents = document.createElement('div');
          currentDayEvents.className = 'activity-day-events';
          daySection.appendChild(dayNode);
          daySection.appendChild(currentDayEvents);
          activityLogList.appendChild(daySection);
        }
        const row = document.createElement('article');
        row.className = 'activity-row activity-severity-' + String(ev.severity_name || 'info');
        const time = document.createElement('time');
        time.className = 'activity-row-time';
        time.textContent = formatActivityTime(date);
        if (date) time.dateTime = date.toISOString();
        const rail = document.createElement('div');
        rail.className = 'activity-row-rail';
        const icon = document.createElement('span');
        icon.className = 'ui-msr activity-row-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = String(ev.icon || 'history');
        rail.appendChild(icon);
        const selection = document.createElement('input');
        selection.type = 'checkbox';
        selection.className = 'activity-row-selection';
        selection.dataset.sequence = String(ev.seq);
        selection.checked = activitySelectedSequences.has(Number(ev.seq));
        selection.disabled = activityDeleting || !!activityConfirmationSequences || getSession().role !== 'admin';
        selection.setAttribute('aria-label', 'Sélectionner : ' + String(ev.title || 'Activité'));
        selection.addEventListener('change', () => {
          if (selection.checked) activitySelectedSequences.add(Number(ev.seq));
          else activitySelectedSequences.delete(Number(ev.seq));
          updateActivitySelection();
        });
        rail.appendChild(selection);
        const main = document.createElement('div');
        main.className = 'activity-row-main';
        const title = document.createElement('div');
        title.className = 'activity-row-title';
        const strong = document.createElement('strong');
        strong.textContent = String(ev.title || 'Activité');
        title.appendChild(strong);
        const meta = document.createElement('div');
        meta.className = 'activity-row-meta';
        meta.textContent = formatActivityRelative(date) + ' · ' + formatActivityActor(ev);
        main.appendChild(title);
        if (ev.detail) {
          const detail = document.createElement('div');
          detail.className = 'activity-row-detail';
          detail.textContent = String(ev.detail);
          main.appendChild(detail);
        }
        main.appendChild(meta);
        row.appendChild(time);
        row.appendChild(rail);
        row.appendChild(main);
        currentDayEvents.appendChild(row);
      });
      activityLogList.querySelectorAll('.activity-day-events').forEach((dayEvents) => {
        const rows = dayEvents.querySelectorAll('.activity-row');
        if (!rows.length) return;
        rows[0].classList.add('is-first');
        rows[rows.length - 1].classList.add('is-last');
      });
      if (activityLogStatus && stats) {
        activityLogStatus.textContent =
          filtered.length + '/' + (Number(stats.entries) || filtered.length) +
          ' événement(s)';
      }
    }

    async function refreshActivityLog(showBusy) {
      if (!activityLogList) return;
      if (showBusy && activityLogStatus) activityLogStatus.textContent = 'Chargement du journal...';

      if (activityAbortController) activityAbortController.abort();
      const controller = new AbortController();
      activityAbortController = controller;
      updateActivitySelection();
      const requestToken = ++activityRequestToken;
      const limit = 64;
      let offset = 0;
      const events = [];
      const seenSequences = new Set();
      let stats = null;

      try {
        while (true) {
          const url =
            '/api/activity/logs?order=desc&offset=' + encodeURIComponent(offset) +
            '&limit=' + limit;
          const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const page = await response.json();
          if (requestToken !== activityRequestToken) return;

          stats = page;
          const pageEvents = Array.isArray(page.events) ? page.events : [];
          pageEvents.forEach((event) => {
            const sequence = Number(event && event.seq) || 0;
            if (sequence > 0 && seenSequences.has(sequence)) return;
            if (sequence > 0) seenSequences.add(sequence);
            events.push(event);
          });

          if (page.complete || page.next == null || Number(page.count) === 0) break;

          offset = Number(page.next);
          if (!Number.isFinite(offset) || offset < 0 || events.length >= 768) break;
        }

        if (requestToken !== activityRequestToken) return;
        activityLoadedEvents = events;
        activityLoadedStats = stats;
        renderActivityLog(activityLoadedEvents, activityLoadedStats);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        throw err;
      } finally {
        if (activityAbortController === controller) {
          activityAbortController = null;
          updateActivitySelection();
        }
      }
    }

    async function purgeActivityLog(sequences) {
      if (!sequences || !sequences.length || activityDeleting) return;
      activityDeleting = true;
      let deletionMessage = '';
      updateActivitySelection();
      if (activityLogStatus) activityLogStatus.textContent = 'Suppression en cours : 0/' + sequences.length + ' message(s) vérifiés…';
      try {
        for (let offset = 0; offset < sequences.length; offset += 128) {
          const batch = sequences.slice(offset, offset + 128);
          const payload = await fetchOkJson('/api/activity/delete', createFormPostOptions({sequences:JSON.stringify(batch)}), 'suppression refusée', fetch);
          if (!payload || !payload.delete_id) throw new Error('Confirmation de suppression absente.');
          const deadline = Date.now() + 60000;
          while (true) {
            if (Date.now() >= deadline) throw new Error('Délai dépassé : la suppression reste à vérifier.');
            const state = await fetchJsonResponse('/api/activity/status', {cache:'no-store'});
            if (!state.res.ok || !state.data) throw new Error('État de suppression indisponible.');
            if (Number(state.data.delete_id) !== Number(payload.delete_id)) throw new Error('Suppression interrompue ou remplacée.');
            if (Number(state.data.delete_state) === 3) throw new Error('Écriture impossible : la suppression peut être partielle.');
            if (Number(state.data.delete_state) === 2) break;
            const confirmed = Math.min(batch.length, Math.max(0, Number(state.data.delete_removed) || 0));
            if (activityLogStatus) activityLogStatus.textContent = 'Suppression en cours : ' + (offset + confirmed) + '/' + sequences.length + ' message(s) vérifiés…';
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          batch.forEach(seq => activitySelectedSequences.delete(seq));
          const completed = new Set(batch);
          activityLoadedEvents = activityLoadedEvents.filter(event => !completed.has(Number(event.seq)));
          if (activityLoadedStats) activityLoadedStats.entries = activityLoadedEvents.length;
          renderActivityLog(activityLoadedEvents, activityLoadedStats);
          if (activityLogStatus) activityLogStatus.textContent = 'Suppression en cours : ' + (offset + batch.length) + '/' + sequences.length + ' message(s) vérifiés…';
        }
        if (activityLogStatus) activityLogStatus.textContent = 'Suppression enregistrée. Actualisation du journal…';
        await refreshActivityLog(false);
        deletionMessage = 'Sélection supprimée.';
      } catch (err) {
        await refreshActivityLog(false).catch(() => {});
        deletionMessage = 'Suppression impossible : ' + (err.message || String(err));
      } finally {
        activityDeleting = false;
        renderActivityLog(activityLoadedEvents, activityLoadedStats);
        updateActivitySelection();
        if (activityLogStatus) activityLogStatus.textContent = deletionMessage;
      }
    }
    if (activitySelectVisibleBtn) activitySelectVisibleBtn.addEventListener('click', () => {
      if (activityDeleting) return;
      const visible = activityLoadedEvents.filter(activityMatchesFilter);
      const allSelected = visible.length && visible.every(ev => activitySelectedSequences.has(Number(ev.seq)));
      visible.forEach(ev => { if (allSelected) activitySelectedSequences.delete(Number(ev.seq)); else activitySelectedSequences.add(Number(ev.seq)); });
      renderActivityLog(activityLoadedEvents, activityLoadedStats);
    });
    if (activityPeriodScope) activityPeriodScope.addEventListener('change', () => {
      setActivityPeriodScope(activityPeriodScope.value === 'all');
      activitySelectedSequences.clear();
      renderActivityLog(activityLoadedEvents, activityLoadedStats);
    });

    if (activityRefreshBtn) {
      activityRefreshBtn.addEventListener('click', () => refreshActivityLog(true).catch((err) => {
        if (activityLogStatus) activityLogStatus.textContent = 'Journal indisponible: ' + (err && err.message ? err.message : String(err));
      }));
    }
    if (activityPurgeBtn) {
      activityPurgeBtn.addEventListener('click', () => {
        if (activityDeleting || !activitySelectedSequences.size || !activityDeleteConfirmation) return;
        activityConfirmationSequences = [...activitySelectedSequences];
        const question = document.getElementById('activityDeleteQuestion');
        if (question) question.textContent = 'Supprimer uniquement les ' + activityConfirmationSequences.length + ' message(s) sélectionné(s) ? Cette suppression est définitive.';
        activityDeleteConfirmation.hidden = false;
        renderActivityLog(activityLoadedEvents, activityLoadedStats);
      });
    }
    const activityDeleteConfirmBtn = document.getElementById('activityDeleteConfirmBtn');
    const activityDeleteCancelBtn = document.getElementById('activityDeleteCancelBtn');
    if (activityDeleteConfirmBtn) activityDeleteConfirmBtn.addEventListener('click', () => {
      const sequences = activityConfirmationSequences;
      activityConfirmationSequences = null;
      if (activityDeleteConfirmation) activityDeleteConfirmation.hidden = true;
      purgeActivityLog(sequences).catch(err => {
        if (activityLogStatus) activityLogStatus.textContent = 'Suppression impossible : ' + (err.message || String(err));
      });
    });
    if (activityDeleteCancelBtn) activityDeleteCancelBtn.addEventListener('click', () => {
      activityConfirmationSequences = null;
      if (activityDeleteConfirmation) activityDeleteConfirmation.hidden = true;
      renderActivityLog(activityLoadedEvents, activityLoadedStats);
    });
    if (activityPrevBtn) {
      activityPrevBtn.addEventListener('click', () => {
        activityWindowShiftHours += 1;
        activitySelectedSequences.clear();
        updateActivityRangeText();
        refreshActivityLog(false).catch(() => {});
      });
    }
    if (activityNextBtn) {
      activityNextBtn.addEventListener('click', () => {
        activityWindowShiftHours = Math.max(0, activityWindowShiftHours - 1);
        activitySelectedSequences.clear();
        updateActivityRangeText();
        refreshActivityLog(false).catch(() => {});
      });
    }
    activityFilterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        activityFilter = String(btn.dataset.activityFilter || 'all');
        setActivityPeriodScope(true);
        activitySelectedSequences.clear();
        activityFilterBtns.forEach((el) => el.classList.toggle('is-active', el === btn));
        renderActivityLog(activityLoadedEvents, activityLoadedStats);
      });
    });

    return { refresh: refreshActivityLog, hide: cancelActivityLogRefresh };
  }
  pages.activity = { create: create };
})(window);
