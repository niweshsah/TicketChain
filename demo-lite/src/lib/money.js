export function rupeesToPaise(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error('Enter rupees with up to two decimal places');
  const [whole, fraction = ''] = value.split('.');
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (paise < 100n || paise > 100000000n)
    throw new Error('Price must be between ₹1 and ₹10,00,000');
  return Number(paise);
}
