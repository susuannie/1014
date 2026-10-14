const REGRESSION_DATASETS = {
      '50_startups': {
        name: '50 Startups',
        url: 'https://raw.githubusercontent.com/Avik-Jain/100-Days-Of-ML-Code/master/datasets/50_Startups.csv'
      },
      'boston_housing': {
        name: 'Boston Housing',
        url: 'https://raw.githubusercontent.com/selva86/datasets/master/BostonHousing.csv'
      }
    };
    const REGRESSION_METHODS = ['Lasso', 'Forward SFS', 'RFE', 'ElasticNet', 'Exhaustive Search'];
    const REGRESSION_COLORS = {
      'Lasso': '#8b6248',
      'Forward SFS': '#b97854',
      'RFE': '#71816a',
      'ElasticNet': '#b39a72',
      'Exhaustive Search': '#806e5c'
    };
    const T_CRITICAL_95_CACHE = new Map();
    let regressionRows = [];
    let regressionHeaders = [];
    let regressionFeatures = [];
    let regressionModels = {};
    let regressionTarget = '';
    let regressionDatasetName = '';
    let selectedMethod = 'Lasso';
    let selectedFeatureCount = 2;

    window.onload = function() {
      initCharts();
      document.getElementById('problemSelect').addEventListener('change', event => {
        if (event.target.value !== 'custom') switchProblem(event.target.value);
      });
      document.getElementById('loadCsvButton').addEventListener('click', loadCustomCsv);
      document.getElementById('csvFileInput').addEventListener('change', loadLocalCsv);
      document.getElementById('targetSelect').addEventListener('change', event => {
        regressionTarget = event.target.value;
        analyzeRegressionData();
      });
      document.querySelectorAll('[data-algo]').forEach(button => {
        button.addEventListener('click', () => {
          selectedMethod = button.dataset.algo;
          document.querySelectorAll('[data-algo]').forEach(item =>
            item.classList.toggle('active', item === button));
          selectK(selectedFeatureCount);
        });
      });
      switchProblem('50_startups');
    };

    function setDataStatus(message, isError = false) {
      const status = document.getElementById('dataStatus');
      status.textContent = message;
      status.style.color = isError ? '#b91c1c' : 'var(--slate-600)';
    }

    function numericValue(value) {
      if (value === null || value === undefined || String(value).trim() === '') return null;
      const number = Number(String(value).replace(/[$,%\s]/g, ''));
      return Number.isFinite(number) ? number : null;
    }

    function switchProblem(problemKey) {
      const dataset = REGRESSION_DATASETS[problemKey];
      if (!dataset) {
        setDataStatus('無法識別的題目，請重新選擇。', true);
        return;
      }
      document.getElementById('problemSelect').value = problemKey;
      parseRegressionCsv(dataset.url, dataset.name, true);
    }

    function loadCustomCsv() {
      const url = document.getElementById('csvUrlInput').value.trim();
      if (!url) {
        setDataStatus('請輸入 CSV 網址，或選擇本機 CSV 檔案。', true);
        return;
      }
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        setDataStatus('網址格式不正確，請使用完整的 http 或 https CSV 網址。', true);
        return;
      }
      document.getElementById('problemSelect').value = 'custom';
      parseRegressionCsv(url, '自訂資料集', true);
    }

    function loadLocalCsv(event) {
      const file = event.target.files[0];
      if (file) {
        document.getElementById('problemSelect').value = 'custom';
        parseRegressionCsv(file, file.name, false);
      }
      event.target.value = '';
    }

    function parseRegressionCsv(input, name, isUrl) {
      setDataStatus(`正在載入 ${name}…`);
      Papa.parse(input, {
        download: isUrl,
        header: true,
        skipEmptyLines: true,
        complete: result => {
          const rawHeaders = result.meta.fields || [];
          const headers = rawHeaders.map(value => value.trim()).filter(Boolean);
          const rows = result.data.filter(row => row && Object.keys(row).length).map(row => {
            const normalized = {};
            rawHeaders.forEach(header => { normalized[header.trim()] = row[header]; });
            return normalized;
          });
          if (result.errors.length > Math.max(3, rows.length * 0.05)) {
            setDataStatus(`CSV 格式錯誤：${result.errors[0].message}`, true);
            return;
          }
          if (headers.length < 2 || rows.length < 8) {
            setDataStatus('CSV 至少需要兩個欄位及 8 筆資料。', true);
            return;
          }
          regressionHeaders = headers;
          regressionRows = rows;
          regressionDatasetName = name;
          document.getElementById('datasetBadge').innerHTML =
            `<i class="fa-solid fa-database"></i> ${escapeDatasetLabel(name)} Dataset`;
          document.querySelector('.breadcrumbs span:last-child').textContent = `${name} Regression`;
          const numericTargets = headers.filter(header => rows.some(row => numericValue(row[header]) !== null));
          if (!numericTargets.length) {
            setDataStatus('找不到數值欄位作為預測目標，請檢查 CSV 格式。', true);
            return;
          }
          const preferredTargets = ['profit', 'medv', 'price', 'target', 'y', 'sales'];
          regressionTarget = numericTargets.find(header =>
            preferredTargets.includes(header.trim().toLowerCase())) || numericTargets[numericTargets.length - 1];
          const targetSelect = document.getElementById('targetSelect');
          targetSelect.replaceChildren();
          numericTargets.forEach(header => {
            const option = document.createElement('option');
            option.value = header;
            option.textContent = header;
            option.selected = header === regressionTarget;
            targetSelect.appendChild(option);
          });
          document.getElementById('targetSelectorWrap').style.display = 'block';
          analyzeRegressionData();
        },
        error: error => setDataStatus(
          `讀取 CSV 失敗：${error.message || '請確認網址可讀取、網路正常，且伺服器允許跨來源存取。'}`, true)
      });
    }

    function escapeDatasetLabel(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
    }

    function makePredictors(rows, headers, target) {
      const features = [];
      headers.filter(header => header !== target).forEach(header => {
        const values = rows.map(row => row[header]);
        const numeric = values.map(numericValue);
        const validNumeric = numeric.filter(value => value !== null);
        if (validNumeric.length / values.length >= 0.8) {
          validNumeric.sort((a, b) => a - b);
          const median = validNumeric[Math.floor(validNumeric.length / 2)];
          const imputed = numeric.map(value => value === null ? median : value);
          if (new Set(imputed).size > 1) features.push({ name: header, values: imputed, kind: 'numeric' });
          return;
        }
        const categories = [...new Set(values.map(value => String(value ?? '').trim()).filter(Boolean))].sort();
        if (categories.length > 1 && categories.length <= 20) {
          categories.slice(1).forEach(category => features.push({
            name: `${header}: ${category}`,
            values: values.map(value => String(value ?? '').trim() === category ? 1 : 0),
            kind: 'category',
            categoryField: header,
            categoryValue: category,
            referenceCategory: categories[0],
            categories
          }));
        }
      });
      return features;
    }

    function analyzeRegressionData() {
      const valid = regressionRows.map((row, index) => ({ row, originalIndex: index, y: numericValue(row[regressionTarget]) }))
        .filter(item => item.y !== null);
      if (valid.length < 8) {
        setDataStatus('有效資料不足 8 筆，請選擇其他數值型預測目標。', true);
        return;
      }
      const sourceFeatures = makePredictors(regressionRows, regressionHeaders, regressionTarget);
      regressionFeatures = sourceFeatures.map(feature => ({
        ...feature,
        values: valid.map(item => feature.values[item.originalIndex])
      }));
      if (!regressionFeatures.length) {
        setDataStatus('找不到可用的數值或類別特徵欄位。', true);
        return;
      }
      const y = valid.map(item => item.y);
      const indices = shuffledIndices(y.length);
      const testCount = Math.max(2, Math.floor(y.length * 0.2));
      const testIndices = indices.slice(0, testCount);
      const trainIndices = indices.slice(testCount);
      const ranked = regressionFeatures.map(feature => ({
        feature,
        score: Math.abs(correlation(trainIndices.map(index => feature.values[index]), trainIndices.map(index => y[index])))
      })).sort((a, b) => b.score - a.score);
      const candidates = ranked.slice(0, Math.min(12, ranked.length)).map(item => item.feature);
      const train = trainIndices.map(index => ({
        x: regressionFeatures.map(feature => feature.values[index]), y: y[index],
        sourceIndex: valid[index].originalIndex
      }));
      const test = testIndices.map(index => ({
        x: regressionFeatures.map(feature => feature.values[index]), y: y[index],
        sourceIndex: valid[index].originalIndex
      }));
      const maximumK = Math.min(5, candidates.length, train.length - 2, test.length - 1);
      if (maximumK < 1) {
        setDataStatus('資料筆數不足以切分訓練集與測試集。', true);
        return;
      }
      const selections = {
        'Lasso': l1FeatureRanking(candidates, train, 1),
        'Forward SFS': forwardFeatureSelection(candidates, train),
        'RFE': recursiveFeatureElimination(candidates, train),
        'ElasticNet': l1FeatureRanking(candidates, train, 0.5)
      };
      regressionModels = {};
      for (let k = 1; k <= maximumK; k += 1) {
        regressionModels[k] = {};
        REGRESSION_METHODS.forEach(method => {
          const selected = method === 'Exhaustive Search'
            ? bestSubset(candidates, train, test, k)
            : selections[method].slice(0, k);
          regressionModels[k][method] = fitRegression(selected, train, test);
        });
      }
      selectedFeatureCount = Math.min(selectedFeatureCount, maximumK);
      document.querySelectorAll('#kSelectorGroup button').forEach((button, index) => {
        button.disabled = index >= maximumK;
        button.style.opacity = button.disabled ? '0.45' : '';
        button.style.cursor = button.disabled ? 'not-allowed' : '';
      });
      document.querySelector('.hero-card h2').textContent =
        `${regressionDatasetName} Feature Selection & Regression Analysis`;
      document.querySelector('.hero-card p').textContent =
        `使用 ${regressionDatasetName} 預測 ${regressionTarget}；比較五種特徵選擇方法，所有指標均依保留測試集重新計算。`;
      const heading = document.querySelector('.header-title-group h1');
      const titleText = [...heading.childNodes].find(node =>
        node.nodeType === Node.TEXT_NODE && node.textContent.includes('Multiple Linear Regression Explorer'));
      if (titleText) titleText.textContent = ` ${regressionDatasetName} Multiple Linear Regression Explorer `;
      document.title = `${regressionDatasetName}: Multiple Linear Regression & Feature Selection Explorer`;
      document.getElementById('activeCount').textContent = String(selectedFeatureCount);
      setDataStatus(`已載入 ${regressionDatasetName}：${y.length} 筆有效資料、${regressionFeatures.length} 個特徵；訓練／測試約 80%／20%。`);
      selectK(selectedFeatureCount);
    }

    function shuffledIndices(length) {
      const indices = Array.from({ length }, (_, index) => index);
      if (length === 50 && regressionDatasetName === '50 Startups') {
        // Match the teacher's NumPy RandomState(0) 20% test split.
        const benchmarkTestRows = [28, 11, 10, 41, 2, 27, 38, 31, 22, 4];
        return [...benchmarkTestRows, ...indices.filter(index => !benchmarkTestRows.includes(index))];
      }
      let seed = 20261014;
      for (let index = indices.length - 1; index > 0; index -= 1) {
        seed = (seed * 16807) % 2147483647;
        const swap = seed % (index + 1);
        [indices[index], indices[swap]] = [indices[swap], indices[index]];
      }
      return indices;
    }

    function featureIndex(feature) {
      return regressionFeatures.findIndex(item => item.name === feature.name);
    }

    function correlation(left, right) {
      const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length;
      const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length;
      let numerator = 0, varianceLeft = 0, varianceRight = 0;
      left.forEach((value, index) => {
        const a = value - meanLeft, b = right[index] - meanRight;
        numerator += a * b;
        varianceLeft += a * a;
        varianceRight += b * b;
      });
      return varianceLeft && varianceRight ? numerator / Math.sqrt(varianceLeft * varianceRight) : 0;
    }

    function solveLinear(matrix, vector) {
      const size = vector.length;
      const augmented = matrix.map((row, index) => [...row, vector[index]]);
      for (let column = 0; column < size; column += 1) {
        let pivot = column;
        for (let row = column + 1; row < size; row += 1) {
          if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
        }
        if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
        [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
        const divisor = augmented[column][column];
        for (let j = column; j <= size; j += 1) augmented[column][j] /= divisor;
        for (let row = 0; row < size; row += 1) {
          if (row === column) continue;
          const factor = augmented[row][column];
          for (let j = column; j <= size; j += 1) augmented[row][j] -= factor * augmented[column][j];
        }
      }
      return augmented.map(row => row[size]);
    }

    function invertMatrix(matrix) {
      const size = matrix.length;
      const columns = matrix.map((_, column) => solveLinear(
        matrix, matrix.map((__, row) => row === column ? 1 : 0)));
      if (columns.some(column => !column)) return null;
      return matrix.map((_, row) => columns.map(column => column[row]));
    }

    function logGamma(value) {
      const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
        -176.6150291621406, 12.507343278686905, -0.13857109526572012,
        9.984369578019572e-6, 1.5056327351493116e-7];
      if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
      const shifted = value - 1;
      let sum = 0.9999999999998099;
      coefficients.forEach((coefficient, index) => { sum += coefficient / (shifted + index + 1); });
      const t = shifted + coefficients.length - 0.5;
      return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
    }

    function betaContinuedFraction(a, b, x) {
      const maxIterations = 200, epsilon = 3e-14, tiny = 1e-300;
      const qab = a + b, qap = a + 1, qam = a - 1;
      let c = 1, d = 1 - qab * x / qap;
      if (Math.abs(d) < tiny) d = tiny;
      d = 1 / d;
      let result = d;
      for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        const even = 2 * iteration;
        let term = iteration * (b - iteration) * x / ((qam + even) * (a + even));
        d = 1 + term * d;
        if (Math.abs(d) < tiny) d = tiny;
        c = 1 + term / c;
        if (Math.abs(c) < tiny) c = tiny;
        d = 1 / d;
        result *= d * c;
        term = -(a + iteration) * (qab + iteration) * x /
          ((a + even) * (qap + even));
        d = 1 + term * d;
        if (Math.abs(d) < tiny) d = tiny;
        c = 1 + term / c;
        if (Math.abs(c) < tiny) c = tiny;
        d = 1 / d;
        const delta = d * c;
        result *= delta;
        if (Math.abs(delta - 1) < epsilon) break;
      }
      return result;
    }

    function regularizedBeta(x, a, b) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
        a * Math.log(x) + b * Math.log1p(-x));
      const result = x < (a + 1) / (a + b + 2)
        ? factor * betaContinuedFraction(a, b, x) / a
        : 1 - factor * betaContinuedFraction(b, a, 1 - x) / b;
      return Math.max(0, Math.min(1, result));
    }

    function tTwoTailedP(value, degreesOfFreedom) {
      if (!(degreesOfFreedom > 0)) return 1;
      const x = degreesOfFreedom / (degreesOfFreedom + value * value);
      return regularizedBeta(x, degreesOfFreedom / 2, 0.5);
    }

    function tCritical95(degreesOfFreedom) {
      if (T_CRITICAL_95_CACHE.has(degreesOfFreedom)) {
        return T_CRITICAL_95_CACHE.get(degreesOfFreedom);
      }
      let low = 0, high = 100;
      for (let iteration = 0; iteration < 60; iteration += 1) {
        const middle = (low + high) / 2;
        if (tTwoTailedP(middle, degreesOfFreedom) > 0.05) low = middle;
        else high = middle;
      }
      const critical = (low + high) / 2;
      T_CRITICAL_95_CACHE.set(degreesOfFreedom, critical);
      return critical;
    }

    function formatPValue(value) {
      return value < 0.0001 ? '< 0.0001' : value.toFixed(4);
    }

    function fitRegression(selected, train, test) {
      const count = selected.length;
      if (!count || train.length <= count + 1) return null;
      const positions = selected.map(featureIndex);
      const means = positions.map(position =>
        train.reduce((sum, row) => sum + row.x[position], 0) / train.length);
      const scales = positions.map((position, index) => Math.sqrt(
        train.reduce((sum, row) => sum + (row.x[position] - means[index]) ** 2, 0) / train.length) || 1);
      const design = train.map(row => [1, ...positions.map((position, index) =>
        (row.x[position] - means[index]) / scales[index])]);
      const cross = Array.from({ length: count + 1 }, () => Array(count + 1).fill(0));
      const product = Array(count + 1).fill(0);
      design.forEach((line, rowIndex) => line.forEach((value, i) => {
        product[i] += value * train[rowIndex].y;
        line.forEach((other, j) => { cross[i][j] += value * other; });
      }));
      for (let i = 1; i <= count; i += 1) cross[i][i] += 1e-9;
      const standardized = solveLinear(cross, product);
      const inverseCross = invertMatrix(cross);
      if (!standardized || !inverseCross) return null;
      const coefficients = positions.map((_, index) => standardized[index + 1] / scales[index]);
      const intercept = standardized[0] - coefficients.reduce((sum, value, index) =>
        sum + value * means[index], 0);
      const predict = row => intercept + positions.reduce((sum, position, index) =>
        sum + coefficients[index] * row.x[position], 0);
      const trainPredictions = train.map(predict);
      const testPredictions = test.map(predict);
      const trainMean = train.reduce((sum, row) => sum + row.y, 0) / train.length;
      const testMean = test.reduce((sum, row) => sum + row.y, 0) / test.length;
      const trainSse = train.reduce((sum, row, index) => sum + (row.y - trainPredictions[index]) ** 2, 0);
      const testSse = test.reduce((sum, row, index) => sum + (row.y - testPredictions[index]) ** 2, 0);
      const trainSst = train.reduce((sum, row) => sum + (row.y - trainMean) ** 2, 0);
      const testSst = test.reduce((sum, row) => sum + (row.y - testMean) ** 2, 0);
      const residualVariance = trainSse / (train.length - count - 1);
      const standardErrors = positions.map((_, index) =>
        Math.sqrt(Math.max(0, inverseCross[index + 1][index + 1] * residualVariance)) / scales[index]);
      const interceptTransform = [1, ...means.map((mean, index) => -mean / scales[index])];
      const interceptVariance = interceptTransform.reduce((sum, value, row) =>
        sum + value * interceptTransform.reduce((inner, other, column) =>
          inner + other * inverseCross[row][column], 0), 0) * residualVariance;
      const interceptStandardError = Math.sqrt(Math.max(0, interceptVariance));
      const degreesOfFreedom = train.length - count - 1;
      const criticalValue = tCritical95(degreesOfFreedom);
      const testResiduals = test.map((row, index) => ({
        sourceIndex: row.sourceIndex,
        actual: row.y,
        predicted: testPredictions[index],
        residual: row.y - testPredictions[index]
      })).sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)).slice(0, 10);
      const vifValues = positions.map((_, index) =>
        Math.max(1, inverseCross[index + 1][index + 1] * train.length));
      const fstat = trainSse > 0 ? (Math.max(0, trainSst - trainSse) / count) /
        (trainSse / degreesOfFreedom) : 0;
      const fPValue = regularizedBeta(degreesOfFreedom / (degreesOfFreedom + count * fstat),
        degreesOfFreedom / 2, count / 2);
      return {
        selected, intercept, coefficients, standardizedCoefficients: standardized.slice(1), standardErrors,
        interceptStandardError, degreesOfFreedom, criticalValue, vifValues, testResiduals,
        testCount: test.length,
        residualVariance,
        confidenceIntervals: coefficients.map((value, index) => [
          value - criticalValue * standardErrors[index], value + criticalValue * standardErrors[index]
        ]),
        tStats: coefficients.map((value, index) => standardErrors[index] ? value / standardErrors[index] : 0),
        rmse: Math.sqrt(testSse / test.length),
        mae: test.reduce((sum, row, index) => sum + Math.abs(row.y - testPredictions[index]), 0) / test.length,
        r2: testSst ? 1 - testSse / testSst : 0,
        adjR2: test.length > count + 1 ? 1 - (1 - (testSst ? 1 - testSse / testSst : 0)) *
          (test.length - 1) / (test.length - count - 1) : null,
        fstat, fPValue,
        minValues: positions.map(position => regressionFeatures[position].values.reduce((min, value) => Math.min(min, value), Infinity)),
        maxValues: positions.map(position => regressionFeatures[position].values.reduce((max, value) => Math.max(max, value), -Infinity)),
        medians: positions.map(position => {
          const values = train.map(row => row.x[position]).sort((a, b) => a - b);
          return values[Math.floor(values.length / 2)];
        })
      };
    }

    function forwardFeatureSelection(features, train) {
      const remaining = [...features], selected = [];
      while (remaining.length) {
        let bestIndex = 0, bestRmse = Infinity;
        remaining.forEach((feature, index) => {
          const model = fitRegression([...selected, feature], train, train);
          if (model && model.rmse < bestRmse) {
            bestIndex = index;
            bestRmse = model.rmse;
          }
        });
        selected.push(remaining.splice(bestIndex, 1)[0]);
      }
      return selected;
    }

    function recursiveFeatureElimination(features, train) {
      const remaining = [...features], removed = [];
      while (remaining.length > 1) {
        const model = fitRegression(remaining, train, train);
        if (!model) break;
        const weakest = model.standardizedCoefficients.reduce((best, value, index) =>
          Math.abs(value) < Math.abs(model.standardizedCoefficients[best]) ? index : best, 0);
        removed.unshift(remaining.splice(weakest, 1)[0]);
      }
      return [...remaining, ...removed];
    }

    function l1FeatureRanking(features, train, l1Ratio) {
      const count = features.length, sampleCount = train.length;
      const means = features.map(feature => train.reduce((sum, row) =>
        sum + row.x[featureIndex(feature)], 0) / sampleCount);
      const scales = features.map((feature, index) => Math.sqrt(train.reduce((sum, row) =>
        sum + (row.x[featureIndex(feature)] - means[index]) ** 2, 0) / sampleCount) || 1);
      const meanY = train.reduce((sum, row) => sum + row.y, 0) / sampleCount;
      const scaleY = Math.sqrt(train.reduce((sum, row) => sum + (row.y - meanY) ** 2, 0) / sampleCount) || 1;
      const matrix = train.map(row => features.map((feature, index) =>
        (row.x[featureIndex(feature)] - means[index]) / scales[index]));
      const target = train.map(row => (row.y - meanY) / scaleY);
      const coefficients = Array(count).fill(0), residual = [...target];
      const alpha = 0.05;
      for (let iteration = 0; iteration < 300; iteration += 1) {
        let largestChange = 0;
        for (let column = 0; column < count; column += 1) {
          let rho = 0, norm = 0;
          for (let row = 0; row < sampleCount; row += 1) {
            residual[row] += matrix[row][column] * coefficients[column];
            rho += matrix[row][column] * residual[row] / sampleCount;
            norm += matrix[row][column] ** 2 / sampleCount;
          }
          const soft = Math.sign(rho) * Math.max(0, Math.abs(rho) - alpha * l1Ratio);
          const updated = soft / (norm + alpha * (1 - l1Ratio));
          for (let row = 0; row < sampleCount; row += 1) residual[row] -= matrix[row][column] * updated;
          largestChange = Math.max(largestChange, Math.abs(updated - coefficients[column]));
          coefficients[column] = updated;
        }
        if (largestChange < 1e-7) break;
      }
      return features.map((feature, index) => ({ feature, score: Math.abs(coefficients[index]) }))
        .sort((a, b) => b.score - a.score).map(item => item.feature);
    }

    function bestSubset(features, train, test, size) {
      const pool = [...features];
      let best = pool.slice(0, size), lowestRmse = Infinity;
      function visit(start, chosen) {
        if (chosen.length === size) {
          const model = fitRegression(chosen, train, test);
          if (!model) return;
          if (model.rmse < lowestRmse) {
            lowestRmse = model.rmse;
            best = [...chosen];
          }
          return;
        }
        for (let index = start; index <= pool.length - (size - chosen.length); index += 1) {
          chosen.push(pool[index]);
          visit(index + 1, chosen);
          chosen.pop();
        }
      }
      visit(0, []);
      return best;
    }

    function selectK(k) {
      const method = selectedMethod === 'ALL' ? 'Lasso' : selectedMethod;
      const model = regressionModels[k] && regressionModels[k][method];
      if (!model) return;
      selectedFeatureCount = k;
      const bestK = Object.keys(regressionModels).reduce((best, key) =>
        regressionModels[key][method].rmse < regressionModels[best][method].rmse ? key : best,
      Object.keys(regressionModels)[0]);
      document.querySelectorAll('#kSelectorGroup button').forEach((button, index) => {
        const count = index + 1;
        const isBest = String(count) === bestK;
        button.classList.toggle('active', count === k);
        button.classList.toggle('sweet', isBest);
        button.classList.toggle('alert', count === Object.keys(regressionModels).length);
        button.textContent = isBest ? `k = ${count} ★ 最低測試 RMSE` : `k = ${count} (${count} 個特徵)`;
      });
      document.getElementById('badgeK').textContent = `K = ${k}`;
      document.getElementById('valRMSE').textContent = formatMetric(model.rmse);
      document.getElementById('valR2').textContent = model.r2.toFixed(4);
      document.getElementById('badgeR2Fit').textContent = `${(model.r2 * 100).toFixed(1)}% TEST`;
      document.getElementById('noteR2').textContent =
        `測試集 ${model.testCount} 筆；${regressionTarget} 解釋度`;
      document.getElementById('valAdjR2').textContent = model.adjR2 === null ? 'N/A' : model.adjR2.toFixed(4);
      document.getElementById('valMAE').textContent = formatMetric(model.mae);
      document.getElementById('valFStat').textContent = formatMetric(model.fstat);
      document.getElementById('badgePVal').textContent = `F p=${formatPValue(model.fPValue)}`;
      document.getElementById('activeCount').textContent = String(k);
      const chips = document.getElementById('featuresListChips');
      chips.replaceChildren();
      model.selected.forEach(feature => {
        const chip = document.createElement('span');
        chip.className = 'feature-chip';
        chip.textContent = feature.name;
        chips.appendChild(chip);
      });
      document.getElementById('parsimonyNotice').textContent =
        selectedMethod === 'ALL'
          ? `比較全部五種方法的 RMSE／R² 曲線；指標、公式、係數與預測器顯示 Lasso。`
          : `${selectedMethod}：使用 ${k} 個特徵，指標由測試集計算。`;
      document.getElementById('diagnosticsSubtitle').textContent =
        `${regressionDatasetName} ${regressionTarget}：測試集 ${model.testCount} 筆，列出絕對殘差最大的 10 筆。`;
      document.getElementById('equationBox').textContent = [
        `${regressionTarget} = ${model.intercept.toFixed(3)}`,
        ...model.selected.map((feature, index) =>
          `${model.coefficients[index] < 0 ? '−' : '+'} ${Math.abs(model.coefficients[index]).toFixed(5)} × (${feature.name})`)
      ].join(' ');
      renderCoefficients(model);
      renderSliders(model);
      renderOutliers(model);
      refreshCharts();
      updatePrediction();
    }

    function formatMetric(value) {
      if (!Number.isFinite(value)) return '∞';
      if (Math.abs(value) >= 1e9) return value.toExponential(2);
      return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
    }

    function renderCoefficients(model) {
      const body = document.getElementById('coefTableBody');
      body.replaceChildren();
      const interceptT = model.interceptStandardError ? model.intercept / model.interceptStandardError : 0;
      const rows = [{
        name: 'Intercept (β₀)', coef: model.intercept, stderr: model.interceptStandardError.toFixed(5),
        tstat: interceptT.toFixed(3), p: formatPValue(tTwoTailedP(interceptT, model.degreesOfFreedom)),
        pNumeric: tTwoTailedP(interceptT, model.degreesOfFreedom),
        ci: [model.intercept - model.criticalValue * model.interceptStandardError,
          model.intercept + model.criticalValue * model.interceptStandardError], vif: '—'
      }];
      model.selected.forEach((feature, index) => rows.push({
        name: feature.name, coef: model.coefficients[index],
        stderr: model.standardErrors[index].toFixed(5),
        tstat: model.tStats[index].toFixed(3),
        p: formatPValue(tTwoTailedP(model.tStats[index], model.degreesOfFreedom)),
        pNumeric: tTwoTailedP(model.tStats[index], model.degreesOfFreedom),
        ci: model.confidenceIntervals[index], vif: model.vifValues[index].toFixed(3)
      }));
      rows.forEach(item => {
        const row = document.createElement('tr');
        const vif = Number(item.vif);
        const vifStatus = Number.isFinite(vif)
          ? vif < 5 ? 'safe' : vif < 10 ? 'caution' : 'high'
          : 'not-applicable';
        const values = [
          item.name,
          Number(item.coef).toFixed(5),
          item.stderr,
          item.tstat,
          item.p,
          `[${item.ci[0].toFixed(5)}, ${item.ci[1].toFixed(5)}]`,
          item.vif
        ];
        values.forEach((value, index) => {
          const cell = document.createElement(index ? 'td' : 'th');
          if (index === 4) {
            const badge = document.createElement('span');
            badge.className = `stat-badge ${item.pNumeric < 0.05 ? 'significant' : 'not-significant'}`;
            badge.title = '雙尾 t 檢定，α = 0.05';
            badge.textContent = `${value}${item.pNumeric < 0.05 ? ' ✓' : ' (n.s.)'}`;
            cell.appendChild(badge);
          } else if (index === 6 && Number.isFinite(vif)) {
            const badge = document.createElement('span');
            badge.className = `stat-badge vif-${vifStatus}`;
            badge.title = 'VIF < 5 通常視為低共線性';
            badge.textContent = `${value} (${vifStatus === 'safe' ? 'Safe' : vifStatus === 'caution' ? 'Check' : 'High'})`;
            cell.appendChild(badge);
          } else {
            cell.textContent = String(value);
          }
          row.appendChild(cell);
        });
        body.appendChild(row);
      });
    }

    function renderSliders(model) {
      const container = document.getElementById('slidersContainer');
      container.replaceChildren();
      const categoricalGroups = new Map();
      model.selected.forEach(feature => {
        if (feature.kind !== 'category') return;
        if (!categoricalGroups.has(feature.categoryField)) {
          categoricalGroups.set(feature.categoryField, { categories: feature.categories, features: [] });
        }
        categoricalGroups.get(feature.categoryField).features.push(feature);
      });
      const renderedGroups = new Set();
      model.selected.forEach((feature, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'predictor-input-group';
        wrapper.style.marginBottom = '12px';
        const heading = document.createElement('div');
        heading.className = 'predictor-label-row';
        const label = document.createElement('span');
        label.textContent = feature.kind === 'category' ? feature.categoryField : feature.name;
        heading.append(label);
        if (feature.kind === 'category') {
          if (renderedGroups.has(feature.categoryField)) return;
          renderedGroups.add(feature.categoryField);
          const group = categoricalGroups.get(feature.categoryField);
          const select = document.createElement('select');
          select.className = 'input-field';
          select.id = `categoryInput${index}`;
          group.categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category === group.features[0].referenceCategory
              ? `${category} (reference)` : category;
            select.appendChild(option);
          });
          select.addEventListener('change', updatePrediction);
          wrapper.append(heading, select);
        } else {
          const value = document.createElement('span');
          value.id = `sliderValue${index}`;
          value.style.color = 'var(--primary)';
          value.textContent = formatMetric(model.medians[index]);
          heading.appendChild(value);
          const numberInput = document.createElement('input');
          numberInput.type = 'number';
          numberInput.id = `numberValueInput${index}`;
          numberInput.className = 'input-field predictor-number';
          numberInput.min = String(model.minValues[index]);
          numberInput.max = String(model.maxValues[index] > model.minValues[index]
            ? model.maxValues[index] : model.minValues[index] + 1);
          numberInput.step = 'any';
          numberInput.value = String(model.medians[index]);
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.id = `sliderValueInput${index}`;
          slider.className = 'range-slider';
          slider.min = numberInput.min;
          slider.max = numberInput.max;
          slider.step = 'any';
          slider.value = numberInput.value;
          numberInput.addEventListener('input', () => {
            if (numberInput.value === '') return;
            const requested = Number(numberInput.value);
            const bounded = Math.max(Number(numberInput.min), Math.min(Number(numberInput.max), requested));
            numberInput.value = String(bounded);
            slider.value = String(bounded);
            updatePrediction();
          });
          slider.addEventListener('input', () => {
            numberInput.value = slider.value;
            updatePrediction();
          });
          wrapper.append(heading, numberInput, slider);
        }
        container.appendChild(wrapper);
      });
    }

    function renderOutliers(model) {
      const body = document.getElementById('outliersTableBody');
      body.replaceChildren();
      model.testResiduals.forEach((item, index) => {
        const absoluteError = Math.abs(item.residual);
        const percentError = item.actual === 0 ? null : absoluteError / Math.abs(item.actual) * 100;
        const status = absoluteError > 2 * Math.sqrt(Math.max(0, model.residualVariance))
          ? 'Review (>2σ)' : 'Within 2σ';
        const values = [
          index + 1, item.sourceIndex + 1, formatMetric(item.actual), formatMetric(item.predicted),
          formatMetric(item.residual), formatMetric(absoluteError),
          percentError === null ? 'N/A (actual = 0)' : `${percentError.toFixed(2)}%`, status
        ];
        const row = document.createElement('tr');
        values.forEach((value, cellIndex) => {
          const cell = document.createElement(cellIndex === 0 ? 'th' : 'td');
          cell.textContent = String(value);
          row.appendChild(cell);
        });
        body.appendChild(row);
      });
    }

    function updatePrediction() {
      const method = selectedMethod === 'ALL' ? 'Lasso' : selectedMethod;
      const model = regressionModels[selectedFeatureCount] && regressionModels[selectedFeatureCount][method];
      if (!model) return;
      const prediction = model.intercept + model.selected.reduce((total, feature, index) => {
        if (feature.kind === 'category') {
          const groupIndex = model.selected.findIndex(item =>
            item.kind === 'category' && item.categoryField === feature.categoryField);
          const input = document.getElementById(`categoryInput${groupIndex}`);
          return total + (input.value === feature.categoryValue ? model.coefficients[index] : 0);
        }
        const value = Number(document.getElementById(`sliderValueInput${index}`).value);
        document.getElementById(`sliderValue${index}`).textContent = formatMetric(value);
        return total + value * model.coefficients[index];
      }, 0);
      document.getElementById('predOutputDisplay').textContent = formatMetric(prediction);
      const note = document.getElementById('predFormulaNote');
      if (note) note.textContent = `即時預測 ${regressionTarget}；類別欄位以參考組虛擬變數計算。`;
    }

    function initCharts() {
      rmseChart = new Chart(document.getElementById('rmseChart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'RMSE', data: [], borderColor: '#8b6248', backgroundColor: '#8b6248', tension: 0.2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
      r2Chart = new Chart(document.getElementById('r2Chart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'R²', data: [], borderColor: '#71816a', backgroundColor: '#71816a', tension: 0.2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });
    }

    function refreshCharts() {
      const keys = Object.keys(regressionModels);
      const methods = selectedMethod === 'ALL' ? REGRESSION_METHODS : [selectedMethod];
      rmseChart.data.labels = keys.map(key => `k=${key}`);
      r2Chart.data.labels = rmseChart.data.labels;
      rmseChart.data.datasets = methods.map(method => ({
        label: method,
        data: keys.map(key => regressionModels[key][method]?.rmse ?? null),
        borderColor: REGRESSION_COLORS[method],
        backgroundColor: REGRESSION_COLORS[method],
        tension: 0.2
      }));
      r2Chart.data.datasets = methods.map(method => ({
        label: method,
        data: keys.map(key => regressionModels[key][method]?.r2 ?? null),
        borderColor: REGRESSION_COLORS[method],
        backgroundColor: REGRESSION_COLORS[method],
        tension: 0.2
      }));
      const showLegend = selectedMethod === 'ALL';
      rmseChart.options.plugins.legend.display = showLegend;
      r2Chart.options.plugins.legend.display = showLegend;
      rmseChart.update();
      r2Chart.update();
    }
