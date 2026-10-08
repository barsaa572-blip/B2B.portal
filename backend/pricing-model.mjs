export function cnyFundingEnabled() {
  const model = process.env.PRICING_MODEL || 'legacy';
  if (!['legacy', 'cny-funding-v1'].includes(model)) throw new Error('Unknown pricing model.');
  return model === 'cny-funding-v1';
}
