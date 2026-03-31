export function buildQuote(aiItems, pricingConfig) {
  const configMap = Object.fromEntries(
    pricingConfig.map(c => [c.service_code, c])
  );

  const lineItems = aiItems.map(item => {
    const cfg = configMap[item.service_code] ?? configMap['general_labor'];
    let unit_price = 0;
    let total      = 0;

    if (cfg.type === 'per_unit' || cfg.type === 'time_based') {
      unit_price = parseFloat(cfg.unit_rate);
      total      = unit_price * (item.qty ?? 1);
    } else if (cfg.type === 'per_tier' && item.tier) {
      unit_price = parseFloat(cfg[`tier_${item.tier}`] ?? cfg.tier_md);
      total      = unit_price * (item.qty ?? 1);
    }

    // Apply minimum charge if set
    if (cfg.min_charge && total < parseFloat(cfg.min_charge)) {
      total = parseFloat(cfg.min_charge);
    }

    return {
      ...item,
      unit_price,
      total,
      label: cfg.label,
      unit:  item.unit ?? cfg.unit_label
    };
  });

  const subtotal = lineItems.reduce((sum, i) => sum + i.total, 0);
  return { lineItems, subtotal };
}
