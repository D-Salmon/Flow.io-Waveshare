(function (global) {
  'use strict';
  var pages = global.FlowWebPages = global.FlowWebPages || {};
  function create({ tr, nettoyerNomFlowCfg, fetchOkJson, fetchWithBusyRetry, fetchRuntimeValues,
    fetchJsonResponse, createFormPostOptions, formatFlowCfgApplyError, bindClickAction }) {
    const calibrationSensorSelect = document.getElementById('calibrationSensorSelect');
    const calibrationLoadBtn = document.getElementById('calibrationLoadBtn');
    const calibrationComputeBtn = document.getElementById('calibrationComputeBtn');
    const calibrationApplyBtn = document.getElementById('calibrationApplyBtn');
    const calibrationPoint1Measured = document.getElementById('calibrationPoint1Measured');
    const calibrationPoint1Reference = document.getElementById('calibrationPoint1Reference');
    const calibrationPoint1LiveBtn = document.getElementById('calibrationPoint1LiveBtn');
    const calibrationPoint2Measured = document.getElementById('calibrationPoint2Measured');
    const calibrationPoint2Reference = document.getElementById('calibrationPoint2Reference');
    const calibrationPoint2LiveBtn = document.getElementById('calibrationPoint2LiveBtn');
    const calibrationSingleMeasured = document.getElementById('calibrationSingleMeasured');
    const calibrationSingleReference = document.getElementById('calibrationSingleReference');
    const calibrationSingleLiveBtn = document.getElementById('calibrationSingleLiveBtn');
    const calibrationTwoPointFields = document.getElementById('calibrationTwoPointFields');
    const calibrationOnePointFields = document.getElementById('calibrationOnePointFields');
    const calibrationModeHint = document.getElementById('calibrationModeHint');
    const calibrationIoModule = document.getElementById('calibrationIoModule');
    const calibrationC0Current = document.getElementById('calibrationC0Current');
    const calibrationC1Current = document.getElementById('calibrationC1Current');
    const calibrationPreview = document.getElementById('calibrationPreview');
    const calibrationChecks = document.getElementById('calibrationChecks');
    const calibrationStatus = document.getElementById('calibrationStatus');
    const calibrationStatusChip = document.getElementById('calibrationStatusChip');
    let calibrationLoadedOnce = false;
    let calibrationContext = null;
    let calibrationComputed = null;
    const calibrationSensorDefs = Object.freeze({
      ph: {
        key: 'ph',
        label: 'pH',
        mode: 'two',
        poollogicKey: 'ph_io_id',
        ioSlot: 1,
        runtimeUiId: 2203,
        recommendedSpan: 1.5,
        warningOffset: 1.0,
        defaultC0: 0.9583,
        defaultC1: 4.834
      },
      ph_one: {
        key: 'ph_one',
        label: 'pH (1 point)',
        mode: 'one',
        poollogicKey: 'ph_io_id',
        ioSlot: 1,
        runtimeUiId: 2203,
        recommendedSpan: 0,
        warningOffset: 1.0,
        defaultC0: 0.9583,
        defaultC1: 4.834
      },
      orp: {
        key: 'orp',
        label: 'ORP',
        mode: 'two',
        poollogicKey: 'dis_io_id',
        ioSlot: 0,
        runtimeUiId: 2204,
        recommendedSpan: 120,
        warningOffset: 120,
        defaultC0: 129.2,
        defaultC1: 384.1
      },
      orp_one: {
        key: 'orp_one',
        label: 'ORP (1 point)',
        mode: 'one',
        poollogicKey: 'dis_io_id',
        ioSlot: 0,
        runtimeUiId: 2204,
        recommendedSpan: 0,
        warningOffset: 120,
        defaultC0: 129.2,
        defaultC1: 384.1
      },
      psi: {
        key: 'psi',
        label: 'Pression (bar)',
        mode: 'two',
        poollogicKey: 'psi_io_id',
        ioSlot: 2,
        runtimeUiId: 2206,
        recommendedSpan: 0.4,
        warningOffset: 0.6,
        defaultC0: 0.377923399,
        defaultC1: -0.17634473
      },
      water_temp: {
        key: 'water_temp',
        label: 'Température eau',
        mode: 'one',
        poollogicKey: 'wat_temp_io_id',
        ioSlot: 4,
        runtimeUiId: 2201,
        recommendedSpan: 0,
        warningOffset: 2.0,
        defaultC0: 1.0,
        defaultC1: 0.0
      },
      air_temp: {
        key: 'air_temp',
        label: 'Température air',
        mode: 'one',
        poollogicKey: 'air_temp_io_id',
        ioSlot: 5,
        runtimeUiId: 2202,
        recommendedSpan: 0,
        warningOffset: 2.0,
        defaultC0: 1.0,
        defaultC1: 0.0
      }
    });
    function calibrationNormalizeSensorKey(rawKey) {
      const key = String(rawKey || '').trim();
      if (Object.prototype.hasOwnProperty.call(calibrationSensorDefs, key)) return key;
      return 'ph';
    }

    function calibrationSensorDef(sensorKey) {
      return calibrationSensorDefs[calibrationNormalizeSensorKey(sensorKey)];
    }

    function calibrationCurrentSensorDef() {
      const selected = calibrationSensorSelect ? calibrationSensorSelect.value : 'ph';
      return calibrationSensorDef(selected);
    }

    function calibrationParseNumberLoose(rawValue) {
      if (rawValue === null || typeof rawValue === 'undefined') return NaN;
      const normalized = String(rawValue).trim().replace(',', '.');
      if (!normalized) return NaN;
      const value = Number(normalized);
      return Number.isFinite(value) ? value : NaN;
    }

    function calibrationReadInputNumber(inputEl, label) {
      const value = calibrationParseNumberLoose(inputEl ? inputEl.value : '');
      if (!Number.isFinite(value)) {
        throw new Error(label + ' invalide');
      }
      return value;
    }

    function calibrationFormatNumber(value, maxDecimals) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '-';
      const decimals = Math.max(0, Math.min(8, Number(maxDecimals)));
      const fixed = n.toFixed(Number.isFinite(decimals) ? decimals : 4);
      const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/g, '$1').replace(/\.0+$/g, '');
      return trimmed.replace('.', ',');
    }

    function calibrationPatchNumber(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(tr('calibration.err.invalidCoefficient', 'coefficient invalide'));
      return Number(n.toFixed(9));
    }

    function calibrationSetStatus(message, tone) {
      const text = String(message || '').trim() || tr('calibration.ready', 'Étalonnage prêt.');
      if (calibrationStatus) {
        calibrationStatus.textContent = text;
        calibrationStatus.classList.remove('is-ok', 'is-error', 'is-busy');
        if (tone === 'ok') calibrationStatus.classList.add('is-ok');
        else if (tone === 'error') calibrationStatus.classList.add('is-error');
        else if (tone === 'busy') calibrationStatus.classList.add('is-busy');
      }
      if (calibrationStatusChip) {
        if (tone === 'busy') {
          calibrationStatusChip.textContent = tr('calibration.chip.loading', 'Chargement');
        } else if (tone === 'error') {
          calibrationStatusChip.textContent = tr('calibration.chip.error', 'Erreur');
        } else if (tone === 'ok') {
          calibrationStatusChip.textContent = tr('calibration.chip.ok', 'OK');
        } else {
          calibrationStatusChip.textContent = tr('calibration.chip.ready', 'Prêt');
        }
      }
    }

    function calibrationSetSummary(moduleName, c0, c1) {
      if (calibrationIoModule) {
        calibrationIoModule.textContent = moduleName && String(moduleName).trim() ? String(moduleName).trim() : '-';
      }
      if (calibrationC0Current) {
        calibrationC0Current.textContent = Number.isFinite(c0) ? calibrationFormatNumber(c0, 6) : '-';
      }
      if (calibrationC1Current) {
        calibrationC1Current.textContent = Number.isFinite(c1) ? calibrationFormatNumber(c1, 6) : '-';
      }
    }

    function calibrationSetModeUi(mode) {
      const twoPoint = mode === 'two';
      if (calibrationTwoPointFields) calibrationTwoPointFields.hidden = !twoPoint;
      if (calibrationOnePointFields) calibrationOnePointFields.hidden = twoPoint;
      if (calibrationModeHint) {
        calibrationModeHint.textContent = twoPoint
          ? tr('calibration.mode.two.hint', 'Mode 2 points actif: recalcul de C0 et C1.')
          : tr('calibration.mode.one.hint', 'Mode 1 point actif: C0 conservé, ajustement de C1 (offset).');
      }
    }

    function calibrationResetComputedUi() {
      calibrationComputed = null;
      if (calibrationPreview) {
        calibrationPreview.hidden = true;
        calibrationPreview.innerHTML = '';
      }
      if (calibrationChecks) {
        calibrationChecks.hidden = true;
        calibrationChecks.innerHTML = '';
      }
      if (calibrationApplyBtn) calibrationApplyBtn.disabled = true;
    }

    function calibrationIoModuleFromId(ioIdRaw) {
      const ioId = Number(ioIdRaw);
      if (!Number.isFinite(ioId)) return '';
      const idx = Math.round(ioId) - 192;
      if (idx >= 0 && idx <= 15) {
        return 'io/input/a' + String(idx).padStart(2, '0');
      }
      return '';
    }

    function calibrationIoIdFromAnalogSlot(slotRaw) {
      const slot = Number(slotRaw);
      if (!Number.isFinite(slot)) return NaN;
      const idx = Math.trunc(slot);
      if (idx < 0 || idx > 15) return NaN;
      return 192 + idx;
    }

    async function calibrationFetchFlowModule(moduleName) {
      const cleanModule = nettoyerNomFlowCfg(moduleName);
      if (!cleanModule) throw new Error(tr('calibration.err.invalidModule', 'module invalide'));
      const data = await fetchOkJson(
        '/api/flowcfg/module?name=' + encodeURIComponent(cleanModule),
        { cache: 'no-store' },
        'lecture module ' + cleanModule + ' impossible',
        fetchWithBusyRetry
      );
      if (!data || typeof data.data !== 'object' || Array.isArray(data.data)) {
        throw new Error(tr('calibration.err.invalidModuleNamed', 'module {module} invalide').replace('{module}', cleanModule));
      }
      return data.data;
    }

    function calibrationExtractCoeffKeys(moduleData, moduleName) {
      const source = (moduleData && typeof moduleData === 'object' && !Array.isArray(moduleData)) ? moduleData : {};
      const keys = Object.keys(source);
      const c0Key = keys.find((key) => /_c0$/i.test(String(key || ''))) || '';
      const c1Key = keys.find((key) => /_c1$/i.test(String(key || ''))) || '';
      if (!c0Key || !c1Key) {
        throw new Error(tr('calibration.err.coeffNotFound', 'coefficients C0/C1 introuvables dans {module}').replace('{module}', moduleName));
      }
      return { c0Key, c1Key };
    }

    function calibrationSyncSelectionUi() {
      const def = calibrationCurrentSensorDef();
      calibrationSetModeUi(def.mode);
      calibrationResetComputedUi();
      if (!calibrationContext || calibrationContext.sensorKey !== def.key) {
        calibrationContext = null;
        calibrationSetSummary('-', NaN, NaN);
      }
      calibrationSetLiveFillButtonsDisabled(!calibrationContext);
    }

    function calibrationSetLiveFillButtonsDisabled(disabled) {
      if (calibrationPoint1LiveBtn) calibrationPoint1LiveBtn.disabled = disabled;
      if (calibrationPoint2LiveBtn) calibrationPoint2LiveBtn.disabled = disabled;
      if (calibrationSingleLiveBtn) calibrationSingleLiveBtn.disabled = disabled;
    }

    async function loadCalibrationSensorConfig(prefillLive) {
      const def = calibrationCurrentSensorDef();
      if (calibrationSensorSelect && calibrationSensorSelect.value !== def.key) {
        calibrationSensorSelect.value = def.key;
      }
      calibrationSetModeUi(def.mode);
      calibrationResetComputedUi();
      calibrationSetStatus(tr('calibration.loadingSensorCfg', 'Chargement de la configuration sonde...'), 'busy');
      if (calibrationLoadBtn) calibrationLoadBtn.disabled = true;
      calibrationSetLiveFillButtonsDisabled(true);

      try {
        const poolSensorCfg = await calibrationFetchFlowModule('poollogic/sensors');
        let ioId = Number(poolSensorCfg[def.poollogicKey]);
        if (!Number.isFinite(ioId) || !calibrationIoModuleFromId(ioId)) {
          ioId = calibrationIoIdFromAnalogSlot(def.ioSlot);
        }
        if (!Number.isFinite(ioId) || ioId <= 0) {
          throw new Error(tr('calibration.err.ioNotConfigured', 'IO non configurée pour {sensor}').replace('{sensor}', def.label));
        }
        const ioModule = calibrationIoModuleFromId(ioId);
        if (!ioModule) {
          throw new Error(tr('calibration.err.unknownAnalogIo', 'IO analogique inconnue (id={id})').replace('{id}', String(ioId)));
        }
        const ioCfg = await calibrationFetchFlowModule(ioModule);
        const coeffKeys = calibrationExtractCoeffKeys(ioCfg, ioModule);
        const c0 = calibrationParseNumberLoose(ioCfg[coeffKeys.c0Key]);
        const c1 = calibrationParseNumberLoose(ioCfg[coeffKeys.c1Key]);
        if (!Number.isFinite(c0) || !Number.isFinite(c1)) {
          throw new Error(tr('calibration.err.invalidCoeffForModule', 'C0/C1 invalides pour {module}').replace('{module}', ioModule));
        }

        calibrationContext = {
          sensorKey: def.key,
          sensorLabel: def.label,
          mode: def.mode,
          runtimeUiId: def.runtimeUiId,
          recommendedSpan: Number(def.recommendedSpan) || 0,
          warningOffset: Number(def.warningOffset) || 0,
          ioId: ioId,
          ioModule: ioModule,
          c0Key: coeffKeys.c0Key,
          c1Key: coeffKeys.c1Key,
          c0: c0,
          c1: c1
        };

        calibrationSetSummary(ioModule, c0, c1);
        calibrationSetStatus(tr('calibration.sensorLoaded', 'Sonde {sensor} chargée.').replace('{sensor}', def.label), 'ok');
        calibrationSetLiveFillButtonsDisabled(false);

        if (prefillLive) {
          try {
            await calibrationPrefillLiveValue({ silent: true });
          } catch (err) {
            calibrationSetStatus(tr('calibration.loadedWithoutLive', 'Configuration chargée. Mesure en direct indisponible : vérifiez le raccordement de la sonde ou saisissez la mesure manuellement.'), 'warning');
          }
        }
      } catch (err) {
        calibrationContext = null;
        calibrationSetSummary('-', NaN, NaN);
        calibrationSetStatus(tr('calibration.loadFailed', 'Chargement étalonnage échoué: {err}').replace('{err}', String(err)), 'error');
      } finally {
        if (calibrationLoadBtn) calibrationLoadBtn.disabled = false;
      }
    }

    async function calibrationPrefillLiveValue(options) {
      const opts = options || {};
      if (!calibrationContext || !Number.isFinite(calibrationContext.runtimeUiId)) {
        throw new Error(tr('calibration.err.loadSensorFirst', 'chargez d\'abord une sonde'));
      }
      if (!opts.silent) {
        calibrationSetStatus(tr('calibration.readingLive', 'Lecture de la mesure live...'), 'busy');
      }

      const values = await fetchRuntimeValues([calibrationContext.runtimeUiId]);
      const runtimeValue = values.find((item) => Number(item && (item.id ?? item.runtimeId)) === calibrationContext.runtimeUiId);
      if (!runtimeValue || runtimeValue.status === 'not_found' || runtimeValue.status === 'unavailable') {
        throw new Error(tr('calibration.err.liveUnavailable', 'mesure live indisponible'));
      }
      const measured = calibrationParseNumberLoose(runtimeValue.value);
      if (!Number.isFinite(measured)) {
        throw new Error(tr('calibration.err.liveInvalid', 'mesure live invalide'));
      }

      if (opts.targetInput && typeof opts.targetInput.value === 'string') {
        opts.targetInput.value = String(measured);
      } else if (calibrationContext.mode === 'two') {
        const p1Empty = !String(calibrationPoint1Measured && calibrationPoint1Measured.value || '').trim();
        const p2Empty = !String(calibrationPoint2Measured && calibrationPoint2Measured.value || '').trim();
        if (calibrationPoint1Measured && (p1Empty || !p2Empty)) {
          calibrationPoint1Measured.value = String(measured);
        }
        if (calibrationPoint2Measured && p2Empty && !p1Empty) {
          calibrationPoint2Measured.value = String(measured);
        }
      } else if (calibrationSingleMeasured) {
        calibrationSingleMeasured.value = String(measured);
      }

      if (!opts.silent) {
        calibrationSetStatus(
          tr('calibration.liveValueFetched', 'Mesure live récupérée: {value}').replace('{value}', calibrationFormatNumber(measured, 4)),
          'ok'
        );
      }
    }

    function calibrationComputeModel() {
      if (!calibrationContext || !calibrationContext.ioModule) {
        throw new Error(tr('calibration.err.loadSensorFirst', 'chargez d\'abord une sonde'));
      }

      const oldC0 = Number(calibrationContext.c0);
      const oldC1 = Number(calibrationContext.c1);
      if (!Number.isFinite(oldC0) || !Number.isFinite(oldC1)) {
        throw new Error(tr('calibration.err.currentCoeffInvalid', 'coefficients actuels invalides'));
      }
      if (Math.abs(oldC0) < 1e-12) {
        throw new Error(tr('calibration.err.c0TooCloseZero', 'C0 actuel trop proche de 0'));
      }

      if (calibrationContext.mode === 'two') {
        const measured1 = calibrationReadInputNumber(calibrationPoint1Measured, 'Point 1 mesure affichée');
        const reference1 = calibrationReadInputNumber(calibrationPoint1Reference, 'Point 1 référence');
        const measured2 = calibrationReadInputNumber(calibrationPoint2Measured, 'Point 2 mesure affichée');
        const reference2 = calibrationReadInputNumber(calibrationPoint2Reference, 'Point 2 référence');
        if (Math.abs(measured2 - measured1) < 1e-9) {
          throw new Error(tr('calibration.err.twoMeasuredSame', 'les deux mesures affichées doivent être différentes'));
        }

        const raw1 = (measured1 - oldC1) / oldC0;
        const raw2 = (measured2 - oldC1) / oldC0;
        if (!Number.isFinite(raw1) || !Number.isFinite(raw2)) {
          throw new Error(tr('calibration.err.rawConversionImpossible', 'conversion brute impossible'));
        }
        if (Math.abs(raw2 - raw1) < 1e-12) {
          throw new Error(tr('calibration.err.rawPointsTooClose', 'les points bruts sont trop proches'));
        }

        const newC0 = (reference2 - reference1) / (raw2 - raw1);
        const newC1 = reference1 - (newC0 * raw1);
        if (!Number.isFinite(newC0) || !Number.isFinite(newC1)) {
          throw new Error(tr('calibration.err.coeffCalcImpossible', 'calcul des coefficients impossible'));
        }

        return {
          mode: 'two',
          sensorLabel: calibrationContext.sensorLabel,
          moduleName: calibrationContext.ioModule,
          oldC0,
          oldC1,
          newC0,
          newC1,
          measured1,
          measured2,
          reference1,
          reference2,
          raw1,
          raw2,
          spanMeasured: Math.abs(measured2 - measured1),
          spanReference: Math.abs(reference2 - reference1),
          warningOffset: calibrationContext.warningOffset,
          recommendedSpan: calibrationContext.recommendedSpan
        };
      }

      const measured = calibrationReadInputNumber(calibrationSingleMeasured, 'Mesure affichée');
      const reference = calibrationReadInputNumber(calibrationSingleReference, 'Référence');
      const raw = (measured - oldC1) / oldC0;
      if (!Number.isFinite(raw)) {
        throw new Error(tr('calibration.err.rawConversionImpossible', 'conversion brute impossible'));
      }
      const newC0 = oldC0;
      const newC1 = reference - (newC0 * raw);
      if (!Number.isFinite(newC1)) {
        throw new Error(tr('calibration.err.c1CalcImpossible', 'calcul C1 impossible'));
      }

      return {
        mode: 'one',
        sensorLabel: calibrationContext.sensorLabel,
        moduleName: calibrationContext.ioModule,
        oldC0,
        oldC1,
        newC0,
        newC1,
        measured,
        reference,
        raw,
        warningOffset: calibrationContext.warningOffset,
        recommendedSpan: 0
      };
    }

    function calibrationBuildChecks(model) {
      const checks = [];
      if (!model || typeof model !== 'object') return checks;

      if (model.mode === 'two') {
        if (model.recommendedSpan > 0) {
          if (model.spanReference < model.recommendedSpan) {
            checks.push({
              tone: 'warn',
              label: tr('calibration.check.warn', 'Alerte'),
              text: tr('calibration.check.spanWeak', 'L\'écart entre références est faible ({value}). Élargissez les points pour une meilleure précision.')
                .replace('{value}', calibrationFormatNumber(model.spanReference, 3))
            });
          } else {
            checks.push({
              tone: 'ok',
              label: tr('calibration.check.ok', 'OK'),
              text: tr('calibration.check.spanOk', 'Écart entre références correct ({value}).')
                .replace('{value}', calibrationFormatNumber(model.spanReference, 3))
            });
          }
        }
        if (model.newC0 <= 0) {
          checks.push({
            tone: 'warn',
            label: tr('calibration.check.warn', 'Alerte'),
            text: tr('calibration.check.c0Invalid', 'La pente C0 calculée est négative ou nulle. Vérifiez l\'ordre des points et les valeurs saisies.')
          });
        } else {
          checks.push({
            tone: 'ok',
            label: tr('calibration.check.ok', 'OK'),
            text: tr('calibration.check.c0Ok', 'La pente C0 calculée est cohérente.')
          });
        }
      } else {
        const offsetDelta = Math.abs(model.reference - model.measured);
        if (offsetDelta > model.warningOffset && model.warningOffset > 0) {
          checks.push({
            tone: 'warn',
            label: tr('calibration.check.warn', 'Alerte'),
            text: tr('calibration.check.offsetHigh', 'Décalage important ({value}). Vérifiez la référence.')
              .replace('{value}', calibrationFormatNumber(offsetDelta, 3))
          });
        } else {
          checks.push({
            tone: 'ok',
            label: tr('calibration.check.ok', 'OK'),
            text: tr('calibration.check.offsetOk', 'Décalage mesuré compatible avec un étalonnage 1 point.')
          });
        }
      }

      checks.push({
        tone: 'info',
        label: tr('menu.info', 'infos/about'),
        text: tr('calibration.check.moduleTargeted', 'Module ciblé: {module}').replace('{module}', model.moduleName)
      });
      return checks;
    }

    function calibrationRenderPreview(model) {
      if (!calibrationPreview) return;
      calibrationPreview.hidden = false;
      const modeLabel = model.mode === 'two'
        ? tr('calibration.mode.two.title', 'Étalonnage 2 points')
        : tr('calibration.mode.one.title', 'Étalonnage 1 point');
      const rows = [];
      if (model.mode === 'two') {
        rows.push({
          label: 'C0',
          current: calibrationFormatNumber(model.oldC0, 6),
          next: calibrationFormatNumber(model.newC0, 6)
        });
      }
      rows.push({
        label: 'C1',
        current: calibrationFormatNumber(model.oldC1, 6),
        next: calibrationFormatNumber(model.newC1, 6)
      });
      const rowsHtml = rows.map((row) =>
        '<span class="calibration-preview-row-label">' + row.label + '</span>' +
        '<span class="calibration-preview-value calibration-preview-value-current">' + row.current + '</span>' +
        '<b class="calibration-preview-value calibration-preview-value-new">' + row.next + '</b>'
      ).join('');
      const noteHtml = model.mode === 'two'
        ? ''
        : '<div class="calibration-preview-note">' + tr('calibration.preview.onePointNote', 'C0 conservé en mode 1 point (offset).') + '</div>';
      calibrationPreview.innerHTML =
        '<div class="calibration-preview-head">'
          + tr('calibration.preview.head', '{mode} prête pour {sensor}')
            .replace('{mode}', modeLabel)
            .replace('{sensor}', model.sensorLabel)
          + '</div>' +
        '<div class="calibration-preview-grid">' +
          '<span class="calibration-preview-col-head">' + tr('calibration.preview.coefficient', 'Coefficient') + '</span>' +
          '<span class="calibration-preview-col-head">' + tr('calibration.preview.current', 'Actuel') + '</span>' +
          '<span class="calibration-preview-col-head">' + tr('calibration.preview.new', 'Nouveau') + '</span>' +
          rowsHtml +
        '</div>' +
        noteHtml;
    }

    function calibrationRenderChecks(checks) {
      if (!calibrationChecks) return;
      const entries = Array.isArray(checks) ? checks : [];
      if (entries.length === 0) {
        calibrationChecks.hidden = true;
        calibrationChecks.innerHTML = '';
        return;
      }
      calibrationChecks.hidden = false;
      calibrationChecks.innerHTML = '';
      entries.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'calibration-check-line is-' + (entry && entry.tone ? entry.tone : 'info');

        const pill = document.createElement('span');
        pill.className = 'calibration-check-pill';
        pill.textContent = String(entry && entry.label ? entry.label : tr('menu.info', 'infos/about'));
        row.appendChild(pill);

        const text = document.createElement('span');
        text.className = 'calibration-check-text';
        text.textContent = String(entry && entry.text ? entry.text : '');
        row.appendChild(text);

        calibrationChecks.appendChild(row);
      });
    }

    function runCalibrationCompute() {
      try {
        const model = calibrationComputeModel();
        calibrationComputed = model;
        calibrationRenderPreview(model);
        calibrationRenderChecks(calibrationBuildChecks(model));
        if (calibrationApplyBtn) calibrationApplyBtn.disabled = false;
        calibrationSetStatus(tr('calibration.computeDone', 'Nouveaux coefficients calculés. Vous pouvez appliquer.'), 'ok');
      } catch (err) {
        calibrationResetComputedUi();
        calibrationSetStatus(tr('calibration.computeFailed', 'Calcul étalonnage échoué: {err}').replace('{err}', String(err)), 'error');
      }
    }

    async function applyCalibrationResult() {
      if (!calibrationContext || !calibrationComputed) return;
      if (calibrationApplyBtn) calibrationApplyBtn.disabled = true;
      calibrationSetStatus(tr('calibration.applyInProgress', 'Application des coefficients sur flow.io...'), 'busy');

      try {
        const patch = {};
        patch[calibrationContext.ioModule] = {
          [calibrationContext.c0Key]: calibrationPatchNumber(calibrationComputed.newC0),
          [calibrationContext.c1Key]: calibrationPatchNumber(calibrationComputed.newC1)
        };

        const response = await fetchJsonResponse(
          '/api/flowcfg/apply',
          createFormPostOptions({ patch: JSON.stringify(patch) }),
          fetchWithBusyRetry
        );
        if (!response.res.ok || !response.data || response.data.ok !== true) {
          throw new Error(formatFlowCfgApplyError(response.data));
        }

        await loadCalibrationSensorConfig(false);
        calibrationSetStatus(tr('calibration.applySuccess', 'Étalonnage appliqué avec succès.'), 'ok');
      } catch (err) {
        calibrationSetStatus(tr('calibration.applyFailed', 'Application étalonnage échouée: {err}').replace('{err}', String(err)), 'error');
        if (calibrationApplyBtn) calibrationApplyBtn.disabled = !calibrationComputed;
      }
    }

    function initCalibrationBindings() {
      if (!calibrationSensorSelect) return;

      calibrationSensorSelect.addEventListener('change', () => {
        calibrationSyncSelectionUi();
        calibrationSetStatus(tr('calibration.sensorSelected', 'Sonde sélectionnée. Chargez la configuration pour continuer.'));
      });

      bindClickAction(calibrationLoadBtn, () => loadCalibrationSensorConfig(true));

      const bindLiveFill = (button, targetInput, label) => bindClickAction(button, async () => {
        try {
          await calibrationPrefillLiveValue({
            silent: false,
            targetInput: targetInput
          });
        } catch (err) {
          calibrationSetStatus(
            tr('calibration.liveFailedFor', 'Mesure live échouée ({label}): {err}')
              .replace('{label}', label)
              .replace('{err}', String(err)),
            'error'
          );
        }
      });
      bindLiveFill(calibrationPoint1LiveBtn, calibrationPoint1Measured, 'Point 1');
      bindLiveFill(calibrationPoint2LiveBtn, calibrationPoint2Measured, 'Point 2');
      bindLiveFill(calibrationSingleLiveBtn, calibrationSingleMeasured, 'Mesure');
      bindClickAction(calibrationComputeBtn, () => runCalibrationCompute());
      bindClickAction(calibrationApplyBtn, () => applyCalibrationResult());

      calibrationSyncSelectionUi();
      calibrationSetStatus(tr('calibration.ready', 'Étalonnage prêt.'));
    }

    async function show() {
      if (!calibrationLoadedOnce) {
        calibrationLoadedOnce = true;
        await loadCalibrationSensorConfig(true);
        return;
      }
      if (!calibrationContext || !calibrationContext.ioModule) {
        await loadCalibrationSensorConfig(false);
      }
    }

    initCalibrationBindings();
    return { show };
  }
  pages.calibration = { create };
})(window);
