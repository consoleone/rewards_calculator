const axios = require('axios');
const axiosRetry = require('axios-retry');

const api = axios.create({
  baseURL:
    process.env.API_BASE_URL ?? 'https://gatewayde.dev.radixportfolio.info/',
});

axiosRetry(api, {
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    console.log('Retrying request', error.config.url);
    return error.response.status === 500;
  },
});
module.exports = api;
