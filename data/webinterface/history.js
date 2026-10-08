(function (global) {
  'use strict';
  const pages = global.FlowWebPages = global.FlowWebPages || {};
  function create({tr, currentWebLocaleTag, fetchOkJson}) {
    // History is fetched only on entry or explicit refresh, never polled.
    const historyView = { days: [], selected: 0, controller: null, sequence: 0 };
    const historyText = (key, fallback) => tr('history.' + key, fallback);
    function historyNumber(value, unit = '', digits = 1) {
      return value === null || value === undefined || !Number.isFinite(Number(value))
        ? '—' : new Intl.NumberFormat(currentWebLocaleTag(), { maximumFractionDigits: digits }).format(Number(value)) + (unit ? ' ' + unit : '');
    }
    function historyDate(value) {
      const raw = String(value || '');
      if (raw.length !== 8) return '—';
      return new Intl.DateTimeFormat(currentWebLocaleTag(), { day: 'numeric', month: 'short' })
        .format(new Date(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6))));
    }
    function historyCell(row, value, header = false) {
      const cell = document.createElement(header ? 'th' : 'td');
      cell.textContent = value;
      if (header) cell.scope = 'col';
      row.appendChild(cell); return cell;
    }
    function historyTable(target, headings, rows) {
      target.replaceChildren();
      const table = document.createElement('table'); table.className = 'history-table';
      const head = table.createTHead().insertRow(); headings.forEach(value => historyCell(head, value, true));
      const body = table.createTBody();
      rows.forEach(values => { const row = body.insertRow(); values.forEach(value => historyCell(row, value)); });
      target.appendChild(table); return body;
    }
    function renderHistoryDay() {
      const day = historyView.days[historyView.selected];
      const detail = document.getElementById('historyDayDetail');
      detail.hidden = !day || !day.valid;
      if (detail.hidden) return;
      document.getElementById('historyDayTitle').textContent = historyDate(day.date) + ' · ' +
        (day.complete ? historyText('closed', 'Journée clôturée') : historyText('current', 'Journée en cours'));
      const names = [historyText('water', 'Eau'), historyText('air', 'Air'), 'pH', 'ORP',
        historyText('dayWater', 'Eau · journée'), historyText('nightWater', 'Eau · nuit'),
        historyText('phTarget', 'Consigne pH'), historyText('orpTarget', 'Consigne ORP'), historyText('heatTarget', 'Consigne chauffage')];
      const units = ['°C', '°C', '', 'mV', '°C', '°C', '', 'mV', '°C'];
      historyTable(document.getElementById('historyMetrics'), [historyText('measure', 'Mesure'),
        historyText('average', 'Moyenne'), 'Min', 'Max', historyText('first', 'Première'), historyText('last', 'Dernière'),
        historyText('samples', 'Échantillons')], names.map((name, index) => {
          const metric = (day.metrics || [])[index] || {};
          return [name, ...['average', 'min', 'max', 'first', 'last'].map(key => historyNumber(metric[key], units[index], 2)), historyNumber(metric.samples, '', 0)];
        }));
      const periods = [historyText('night', 'Nuit'), historyText('morning', 'Matin'), historyText('afternoon', 'Après-midi'), historyText('evening', 'Soir')];
      historyTable(document.getElementById('historyPeriods'), [historyText('period', 'Période'), historyText('filtration', 'Filtration'), historyText('heating', 'Chauffage')], periods.map((name, i) =>
        [name, ...['filtration', 'heating'].map(key => {
          const seconds = day[key]?.periods?.[i]?.seconds;
          return historyNumber(seconds == null ? null : seconds / 3600, 'h', 2);
        })]));
      const dateTime = value => value ? new Date(value * 1000).toLocaleString(currentWebLocaleTag()) : '—';
      document.getElementById('historyCoverage').textContent = historyText('observed', 'Observations') + ' : ' + dateTime(day.from) + ' → ' + dateTime(day.until);
      document.getElementById('historyNightDelta').textContent = historyText('nightDelta', 'Variation nuit − journée') + ' : ' + historyNumber(day.night_delta, '°C', 2);
    }
    function renderPoolHistory(data) {
      historyView.days = Array.isArray(data.days) ? data.days : [];
      const heading = [historyText('day', 'Jour'), historyText('water', 'Eau') + ' · ' + historyText('average', 'Moyenne'),
        'pH', historyText('filtration', 'Filtration'), historyText('heating', 'Chauffage'),
        historyText('refill', 'Appoint estimé'), historyText('refills', 'Appoints')];
      const rows = historyView.days.map((day, index) => [historyDate(day.date),
        historyNumber(day.metrics?.[0]?.average, '°C'), historyNumber(day.metrics?.[2]?.average, '', 2),
        ...['filtration', 'heating'].map(key => historyNumber(day[key]?.seconds == null ? null : day[key].seconds / 3600, 'h', 2)),
        historyNumber(day.refill_litres, 'L'), historyNumber(day.refill_events, '', 0)]);
      const body = historyTable(document.getElementById('historyDays'), heading, rows);
      [...body.rows].forEach((row, index) => {
        const day = historyView.days[index]; const button = document.createElement('button');
        button.className = 'btn-tonal'; button.textContent = historyDate(day.date) + (index === 0 ? ' · ' + historyText('today', 'Aujourd’hui') : '');
        button.disabled = !day.valid;
        button.setAttribute('aria-pressed', String(index === historyView.selected));
        button.addEventListener('click', () => { historyView.selected = index; renderPoolHistory(data); });
        row.cells[0].replaceChildren(button);
      });
      renderHistoryDay();
      const select = document.getElementById('historyValueId'); const selected = select.value;
      select.replaceChildren();
      const groups = [historyText('analog', 'Analogique'), historyText('digital', 'Entrée'), historyText('rate', 'Débit brut'),
        historyText('total', 'Total converti'), historyText('convertedRate', 'Débit converti'), historyText('derived', 'Valeur dérivée')];
      (data.values || []).forEach(value => {
        const id = Number(value.id); const group = id < 32 ? 0 : 1 + Math.floor((id - 32) / 16);
        const base = [0, 32, 48, 64, 80, 96][group];
        const option = document.createElement('option'); option.value = String(id);
        option.textContent = `${groups[group]} ${id - base + 1} · #${id}`; select.appendChild(option);
      });
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
      document.getElementById('historyValueRead').disabled = !select.options.length;
    }
    function cancelHistoryRequest() {
      ++historyView.sequence;
      if (historyView.controller) historyView.controller.abort();
      historyView.controller = null;
    }
    async function loadHistory(valueOnly = false) {
      cancelHistoryRequest();
      const sequence = historyView.sequence;
      const controller = new AbortController(); historyView.controller = controller;
      const timeout = setTimeout(() => controller.abort(), 12000);
      document.getElementById('historyRefresh').disabled = true;
      document.getElementById('historyValueRead').disabled = true;
      const status = document.getElementById('historyStatus');
      status.textContent = historyText('loading', 'Chargement de l’historique…');
      document.getElementById('page-history').setAttribute('aria-busy', 'true');
      try {
        const id = document.getElementById('historyValueId').value;
        const daily = document.getElementById('historyValuePeriod').value;
        const url = valueOnly ? `/api/history/value?id=${encodeURIComponent(id)}&daily=${encodeURIComponent(daily)}` : '/api/history/pool';
        const data = await fetchOkJson(url, { cache: 'no-store', signal: controller.signal }, historyText('error', 'Historique indisponible'));
        if (sequence !== historyView.sequence) return;
        if (!valueOnly) {
          renderPoolHistory(data);
          status.textContent = data.ready ? historyText('updated', 'Données actualisées. Les tirets indiquent une absence de mesure.') : historyText('waiting', 'Historique en attente de données ou d’une heure valide.');
        } else {
          const records = data.records || [];
          const counter = data.mode === 2;
          const unit = ['', historyText('pulses', 'impulsions'), historyText('pulsesMinute', 'impulsions/min')][data.unit || 0] || '';
          const headings = [historyText('periodUtc', 'Période (UTC)'), (counter ? historyText('delta', 'Variation') : historyText('average', 'Moyenne')) + (unit ? ' · ' + unit : ''),
            counter ? historyText('continuity', 'Continuité') : 'Min / Max', historyText('coverage', 'Couverture')];
          const resultBody = historyTable(document.getElementById('historyValues'), headings, records.map(record => {
            const flags = [];
            if (record.discontinuities) flags.push(historyText('reset', 'Ruptures') + ': ' + record.discontinuities);
            if (record.boundary_uncertain) flags.push(historyText('uncertain', 'Répartition entre périodes incertaine'));
            const amount = counter && data.type === 3 ? record.raw_delta : historyNumber(counter ? record.delta : record.average, '', 3);
            return [new Date(record.start_utc * 1000).toLocaleString(currentWebLocaleTag(), { timeZone: 'UTC' }) + (record.current ? ' · ' + historyText('ongoing', 'En cours') : ''),
              amount, counter ? flags.join(' · ') || '—' : historyNumber(record.min, '', 3) + ' / ' + historyNumber(record.max, '', 3),
              counter ? '—' : historyNumber(record.coverage_ms / 60000, 'min', 1)];
          }));
          resultBody.parentElement.createCaption().textContent = historyText('value', 'Valeur') + ' #' + id + ' · ' + (daily === '1' ? historyText('daily', 'Journalière') : historyText('hourly', 'Horaire'));
          status.textContent = records.length ? historyText('updated', 'Données actualisées. Les tirets indiquent une absence de mesure.') : historyText('empty', 'Aucune période disponible pour cette valeur.');
        }
      } catch (error) {
        if (sequence === historyView.sequence) status.textContent = historyText('error', 'Historique indisponible') + ' · ' + historyText('retry', 'Réessayez avec Actualiser. Les données déjà affichées ne sont pas actualisées.');
      } finally {
        clearTimeout(timeout);
        if (sequence === historyView.sequence) {
          historyView.controller = null;
          document.getElementById('historyRefresh').disabled = false;
          document.getElementById('historyValueRead').disabled = !document.getElementById('historyValueId').options.length;
          document.getElementById('page-history').setAttribute('aria-busy', 'false');
        }
      }
    }
    return { load: loadHistory, hide: cancelHistoryRequest };
  }
  pages.history = { create };
})(window);
