(function () {
  'use strict';

  function toDecimal(percentInput) {
    return Number(percentInput) / 100;
  }

  function formatCurrency(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  }

  function formatPercent(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return `${(value * 100).toFixed(2)}%`;
  }

  function getMonthlyPayment({
    sellerNoteAmount,
    annualInterestRate,
    amortizationYears,
    interestOnly,
  }) {
    if (sellerNoteAmount <= 0) return 0;

    const monthlyRate = annualInterestRate / 12;
    const totalMonths = amortizationYears * 12;

    if (interestOnly) {
      return sellerNoteAmount * monthlyRate;
    }

    if (annualInterestRate === 0) {
      return sellerNoteAmount / totalMonths;
    }

    return (
      (sellerNoteAmount * monthlyRate) /
      (1 - Math.pow(1 + monthlyRate, -totalMonths))
    );
  }

  function getRemainingBalance({
    sellerNoteAmount,
    annualInterestRate,
    amortizationYears,
    balloonYears,
    interestOnly,
  }) {
    if (sellerNoteAmount <= 0) return 0;

    const monthlyRate = annualInterestRate / 12;
    const totalMonths = amortizationYears * 12;
    const balloonMonths = balloonYears * 12;

    if (interestOnly) {
      return sellerNoteAmount;
    }

    if (annualInterestRate === 0) {
      const principalPaid = (sellerNoteAmount / totalMonths) * balloonMonths;
      return Math.max(0, sellerNoteAmount - principalPaid);
    }

    const monthlyPayment = getMonthlyPayment({
      sellerNoteAmount,
      annualInterestRate,
      amortizationYears,
      interestOnly,
    });

    return (
      sellerNoteAmount * Math.pow(1 + monthlyRate, balloonMonths) -
      monthlyPayment *
        ((Math.pow(1 + monthlyRate, balloonMonths) - 1) / monthlyRate)
    );
  }

  function getNominalPaymentsReceived(monthlyPayment, balloonYears) {
    return monthlyPayment * balloonYears * 12;
  }

  function getPVOfPayments(monthlyPayment, annualDiscountRate, balloonYears) {
    const n = balloonYears * 12;
    const monthlyRate = annualDiscountRate / 12;

    if (monthlyPayment === 0 || n === 0) return 0;

    if (annualDiscountRate === 0) {
      return monthlyPayment * n;
    }

    return (
      monthlyPayment *
      ((1 - Math.pow(1 + monthlyRate, -n)) / monthlyRate)
    );
  }

  function getPVOfBalloon(balloonAmount, annualDiscountRate, balloonYears) {
    if (balloonAmount === 0) return 0;

    if (annualDiscountRate === 0) {
      return balloonAmount;
    }

    return balloonAmount / Math.pow(1 + annualDiscountRate, balloonYears);
  }

  function computeIRR(cashFlows, guess = 0.01) {
    const maxIterations = 1000;
    const tolerance = 1e-8;
    let rate = guess;

    for (let i = 0; i < maxIterations; i++) {
      let npv = 0;
      let derivative = 0;

      for (let t = 0; t < cashFlows.length; t++) {
        npv += cashFlows[t] / Math.pow(1 + rate, t);
        if (t > 0) {
          derivative -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
        }
      }

      if (Math.abs(npv) < tolerance) return rate;
      if (Math.abs(derivative) < tolerance) return null;

      rate = rate - npv / derivative;

      if (rate <= -0.999999) return null;
    }

    return null;
  }

  function getSellerAnnualIRR({
    sellerNoteAmount,
    monthlyPayment,
    balloonAmount,
    balloonYears,
  }) {
    const months = balloonYears * 12;
    // Matches Excel: IRR on -seller note principal, then monthly inflows (last includes balloon).
    const cashFlows = [-sellerNoteAmount];

    for (let i = 1; i <= months; i++) {
      cashFlows.push(monthlyPayment);
    }

    cashFlows[cashFlows.length - 1] += balloonAmount;

    const monthlyIRR = computeIRR(cashFlows);
    if (monthlyIRR === null) return null;

    return Math.pow(1 + monthlyIRR, 12) - 1;
  }

  function sellerIrrVsOpportunityCost(sellerAnnualIrr, opportunityCost) {
    if (sellerAnnualIrr === null || sellerAnnualIrr === undefined) return null;
    return (1 + sellerAnnualIrr) / (1 + opportunityCost) - 1;
  }

  function calculateSellerPayout(inputs) {
    const {
      purchasePrice,
      askingPrice,
      downPayment,
      agentCommissionPercent,
      annualInterestRate,
      amortizationYears,
      balloonYears,
      interestOnly,
      opportunityCostLow,
      opportunityCostMedium,
      opportunityCostHigh,
    } = inputs;

    const commissionAmount =
      Number.isFinite(purchasePrice) && Number.isFinite(agentCommissionPercent)
        ? purchasePrice * agentCommissionPercent
        : NaN;
    const cashToSellerAfterCommission =
      Number.isFinite(downPayment) && Number.isFinite(commissionAmount)
        ? downPayment - commissionAmount
        : NaN;
    const percentDown =
      purchasePrice > 0 ? downPayment / purchasePrice : null;

    const sellerNoteAmount = Math.max(0, purchasePrice - downPayment);

    const monthlyPayment = getMonthlyPayment({
      sellerNoteAmount,
      annualInterestRate,
      amortizationYears,
      interestOnly,
    });

    const balloonAmount = getRemainingBalance({
      sellerNoteAmount,
      annualInterestRate,
      amortizationYears,
      balloonYears,
      interestOnly,
    });

    const nominalPayments = getNominalPaymentsReceived(
      monthlyPayment,
      balloonYears
    );

    const nominalTotal = downPayment + nominalPayments + balloonAmount;

    const lowPVPayments = getPVOfPayments(
      monthlyPayment,
      opportunityCostLow,
      balloonYears
    );
    const lowPVBalloon = getPVOfBalloon(
      balloonAmount,
      opportunityCostLow,
      balloonYears
    );
    const lowPVTotal = downPayment + lowPVPayments + lowPVBalloon;

    const midPVPayments = getPVOfPayments(
      monthlyPayment,
      opportunityCostMedium,
      balloonYears
    );
    const midPVBalloon = getPVOfBalloon(
      balloonAmount,
      opportunityCostMedium,
      balloonYears
    );
    const midPVTotal = downPayment + midPVPayments + midPVBalloon;

    const highPVPayments = getPVOfPayments(
      monthlyPayment,
      opportunityCostHigh,
      balloonYears
    );
    const highPVBalloon = getPVOfBalloon(
      balloonAmount,
      opportunityCostHigh,
      balloonYears
    );
    const highPVTotal = downPayment + highPVPayments + highPVBalloon;

    const sellerIRR = getSellerAnnualIRR({
      sellerNoteAmount,
      monthlyPayment,
      balloonAmount,
      balloonYears,
    });

    return {
      purchasePrice,
      askingPrice,
      sellerNoteAmount,
      percentDown,
      commissionAmount,
      cashToSellerAfterCommission,
      monthlyPayment,
      balloonYears,
      balloonAmount,
      nominal: {
        cashAtClosing: downPayment,
        payments: nominalPayments,
        balloon: balloonAmount,
        total: nominalTotal,
        effectivePercentOfAskingPrice:
          askingPrice > 0 ? nominalTotal / askingPrice : null,
        sellerIRR,
      },
      lowOC: {
        cashAtClosing: downPayment,
        payments: lowPVPayments,
        balloon: lowPVBalloon,
        total: lowPVTotal,
        effectivePercentOfAskingPrice:
          askingPrice > 0 ? lowPVTotal / askingPrice : null,
        sellerIrrVsOc:
          sellerIRR !== null
            ? sellerIrrVsOpportunityCost(sellerIRR, opportunityCostLow)
            : null,
      },
      midOC: {
        cashAtClosing: downPayment,
        payments: midPVPayments,
        balloon: midPVBalloon,
        total: midPVTotal,
        effectivePercentOfAskingPrice:
          askingPrice > 0 ? midPVTotal / askingPrice : null,
        sellerIrrVsOc:
          sellerIRR !== null
            ? sellerIrrVsOpportunityCost(sellerIRR, opportunityCostMedium)
            : null,
      },
      highOC: {
        cashAtClosing: downPayment,
        payments: highPVPayments,
        balloon: highPVBalloon,
        total: highPVTotal,
        effectivePercentOfAskingPrice:
          askingPrice > 0 ? highPVTotal / askingPrice : null,
        sellerIrrVsOc:
          sellerIRR !== null
            ? sellerIrrVsOpportunityCost(sellerIRR, opportunityCostHigh)
            : null,
      },
    };
  }

  function getInputs() {
    return {
      purchasePrice: Number(document.getElementById('purchasePrice').value),
      askingPrice: Number(document.getElementById('askingPrice').value),
      downPayment: Number(document.getElementById('downPayment').value),
      annualInterestRate: toDecimal(
        document.getElementById('annualInterestRate').value
      ),
      amortizationYears: Number(
        document.getElementById('amortizationYears').value
      ),
      balloonYears: Number(document.getElementById('balloonYears').value),
      interestOnly: document.getElementById('interestOnly').checked,
      opportunityCostLow: toDecimal(
        document.getElementById('opportunityCostLow').value
      ),
      opportunityCostMedium: toDecimal(
        document.getElementById('opportunityCostMedium').value
      ),
      opportunityCostHigh: toDecimal(
        document.getElementById('opportunityCostHigh').value
      ),
      agentCommissionPercent: toDecimal(
        document.getElementById('agentCommissionPercent').value
      ),
    };
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  const INVALID_OUTPUT_IDS = [
    'sellerNoteAmountDisplay',
    'downPercentDisplay',
    'cashEquivalentMidOcOut',
    'commissionAmountOut',
    'cashToSellerOut',
    'nominalCashAtClosing',
    'lowCashAtClosing',
    'midCashAtClosing',
    'highCashAtClosing',
    'nominalPayments',
    'lowPayments',
    'midPayments',
    'highPayments',
    'nominalBalloon',
    'lowBalloon',
    'midBalloon',
    'highBalloon',
    'nominalTotal',
    'lowTotal',
    'midTotal',
    'highTotal',
    'nominalPctOfAsk',
    'lowPctOfAsk',
    'midPctOfAsk',
    'highPctOfAsk',
    'nominalSellerIrr',
    'lowSellerIrr',
    'midSellerIrr',
    'highSellerIrr',
    'sfIrrCfYear0',
    'sfIrrCfMonthly',
    'sfIrrCfBalloon',
  ];

  function renderInvalidResults(balloonYears) {
    INVALID_OUTPUT_IDS.forEach(function (id) {
      setText(id, '—');
    });
    if (Number.isFinite(balloonYears)) {
      setText(
        'sfIrrCfMonthsLabel',
        `Balloon Payment Months 1 - ${balloonYears * 12}`
      );
      setText('sfIrrCfPayoutLabel', `Year ${balloonYears} Payout`);
    } else {
      setText('sfIrrCfMonthsLabel', 'Balloon Payment Months');
      setText('sfIrrCfPayoutLabel', 'Payout');
    }
  }

  function renderSummaryIrrTable(result) {
    const by = result.balloonYears;
    const months = by * 12;
    setText('sfIrrCfYear0', formatCurrency(result.nominal.cashAtClosing));
    setText(
      'sfIrrCfMonthsLabel',
      `Balloon Payment Months 1 - ${months}`
    );
    setText('sfIrrCfMonthly', formatCurrency(result.monthlyPayment));
    setText('sfIrrCfPayoutLabel', `Year ${by} Payout`);
    setText('sfIrrCfBalloon', formatCurrency(result.balloonAmount));
  }

  function renderResults(result) {
    setText('sellerNoteAmountDisplay', formatCurrency(result.sellerNoteAmount));
    setText('downPercentDisplay', formatPercent(result.percentDown));
    setText(
      'cashEquivalentMidOcOut',
      formatCurrency(result.midOC.total)
    );
    setText('commissionAmountOut', formatCurrency(result.commissionAmount));
    setText(
      'cashToSellerOut',
      formatCurrency(result.cashToSellerAfterCommission)
    );
    renderSummaryIrrTable(result);

    setText('nominalCashAtClosing', formatCurrency(result.nominal.cashAtClosing));
    setText('lowCashAtClosing', formatCurrency(result.lowOC.cashAtClosing));
    setText('midCashAtClosing', formatCurrency(result.midOC.cashAtClosing));
    setText('highCashAtClosing', formatCurrency(result.highOC.cashAtClosing));

    setText('nominalPayments', formatCurrency(result.nominal.payments));
    setText('lowPayments', formatCurrency(result.lowOC.payments));
    setText('midPayments', formatCurrency(result.midOC.payments));
    setText('highPayments', formatCurrency(result.highOC.payments));

    setText('nominalBalloon', formatCurrency(result.nominal.balloon));
    setText('lowBalloon', formatCurrency(result.lowOC.balloon));
    setText('midBalloon', formatCurrency(result.midOC.balloon));
    setText('highBalloon', formatCurrency(result.highOC.balloon));

    setText('nominalTotal', formatCurrency(result.nominal.total));
    setText('lowTotal', formatCurrency(result.lowOC.total));
    setText('midTotal', formatCurrency(result.midOC.total));
    setText('highTotal', formatCurrency(result.highOC.total));

    setText(
      'nominalPctOfAsk',
      formatPercent(result.nominal.effectivePercentOfAskingPrice)
    );
    setText(
      'lowPctOfAsk',
      formatPercent(result.lowOC.effectivePercentOfAskingPrice)
    );
    setText(
      'midPctOfAsk',
      formatPercent(result.midOC.effectivePercentOfAskingPrice)
    );
    setText(
      'highPctOfAsk',
      formatPercent(result.highOC.effectivePercentOfAskingPrice)
    );

    setText('nominalSellerIrr', formatPercent(result.nominal.sellerIRR));
    setText('lowSellerIrr', formatPercent(result.lowOC.sellerIrrVsOc));
    setText('midSellerIrr', formatPercent(result.midOC.sellerIrrVsOc));
    setText('highSellerIrr', formatPercent(result.highOC.sellerIrrVsOc));
  }

  function runCalculation() {
    const inputs = getInputs();
    const amort = inputs.amortizationYears;
    const balloon = inputs.balloonYears;
    const errorEl = document.getElementById('sfAmortBalloonError');
    const amortInput = document.getElementById('amortizationYears');
    const balloonInput = document.getElementById('balloonYears');

    const bothFinite = Number.isFinite(amort) && Number.isFinite(balloon);
    const invalidAmortBalloon = bothFinite && amort < balloon;

    if (invalidAmortBalloon) {
      if (errorEl) errorEl.hidden = false;
      if (amortInput) {
        amortInput.classList.add('sf-calc-input--invalid');
        amortInput.setAttribute('aria-invalid', 'true');
      }
      if (balloonInput) {
        balloonInput.classList.add('sf-calc-input--invalid');
        balloonInput.setAttribute('aria-invalid', 'true');
      }
      renderInvalidResults(balloon);
      return;
    }

    if (errorEl) errorEl.hidden = true;
    if (amortInput) {
      amortInput.classList.remove('sf-calc-input--invalid');
      amortInput.setAttribute('aria-invalid', 'false');
    }
    if (balloonInput) {
      balloonInput.classList.remove('sf-calc-input--invalid');
      balloonInput.setAttribute('aria-invalid', 'false');
    }

    const result = calculateSellerPayout(inputs);
    renderResults(result);
  }

  function init() {
    var root = document.querySelector('.sf-calc-card');
    if (!root) return;


    var debounceId = null;
    function scheduleRun() {
      if (debounceId !== null) {
        window.cancelAnimationFrame(debounceId);
      }
      debounceId = window.requestAnimationFrame(function () {
        debounceId = null;
        runCalculation();
      });
    }

    root.querySelectorAll('input').forEach(function (el) {
      el.addEventListener('input', scheduleRun);
      el.addEventListener('change', scheduleRun);
    });

    runCalculation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
