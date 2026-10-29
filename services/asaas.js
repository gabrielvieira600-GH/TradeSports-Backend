const axios = require('axios');
const base = process.env.ASAAS_ENV === 'production'
  ? 'https://api.asaas.com/v3'
  : 'https://api-sandbox.asaas.com/v3';

function safePath(path) {
  // Avoid logging identifiers, CPF, email, tokens, or query strings.
  return String(path).split('?')[0]
    .replace(/\/(pay_[^/]+|sub_[^/]+|cus_[^/]+)(?=\/|$)/gi, '/:id');
}
async function asaas(method, path, data) {
  if (!process.env.ASAAS_API_KEY) {
    console.error('[ASAAS API] missing ASAAS_API_KEY');
    throw new Error('ASAAS_API_KEY ausente');
  }
  try {
    const response = await axios({
      method, url: base + path, data, timeout: 15000,
      headers: { access_token: process.env.ASAAS_API_KEY, 'Content-Type': 'application/json' }
    });
    return response.data;
  } catch (err) {
    const details = Array.isArray(err.response?.data?.errors)
      ? err.response.data.errors.map(x => ({code: String(x.code || '').slice(0,80), description: String(x.description || '').replace(/[\r\n]/g,' ').slice(0,350)}))
      : undefined;
    console.error('[ASAAS API]', JSON.stringify({
      operation: String(method).toUpperCase(),
      endpoint: safePath(path).replace(/\/(?:payments|subscriptions|customers)\/[^/]+/g, '/$1/:id'),
      status: err.response?.status || null,
      errorCodes: details,
      networkCode: err.code || null
    }));
    if (
  err.response?.status === 400 &&
  String(path).startsWith('/customers')
) {
  console.error(
    '[ASAAS CUSTOMER VALIDATION]',
    JSON.stringify({
      status: err.response.status,
      errors: (err.response.data?.errors || []).map(item => ({
        code: item.code,
        description: item.description
      }))
    })
  );
}
    throw err;
  }
}
module.exports = asaas;
