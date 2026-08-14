/**
 * Server-only Spring Airlines integration boundary.
 * Browser code must never import this module or receive its credentials.
 */
import { createHash } from 'node:crypto';

const required = (value, name) => {
  if (!value) throw new Error(`${name} is not configured on the server.`);
  return value;
};

const trimUrl = value => value.replace(/\/+$/, '');

export function getSpringStatus(env = process.env) {
  return {
    httpJsonReady: Boolean(env.SPRING_HTTP_BASE_URL && env.SPRING_OAUTH_CLIENT_ID && env.SPRING_OAUTH_CLIENT_SECRET),
    xmlOrderQueryReady: Boolean(env.SPRING_XML_WSDL_URL && env.SPRING_XML_USERNAME && env.SPRING_XML_PASSWORD && env.SPRING_XML_ORDER_DETAILS_ACTION),
    endpoints: {
      flightSearch: '/weekApiFlightSearch/ota/flights/searchFlightsOtaDayKegui',
      priceCheck: '/getSpecificPriceNew',
      createOrder: '/apiOrder/ota/orderOtaCtr/bookOrderC',
      cancellationFee: '/apiOrder/ota/orderOtaCtr/calcRetTktFeeOTA',
      refund: '/apiOrder/ota/orderOtaCtr/refundTicketB2cAgentOTA',
      changeInfo: '/apiOrder/ota/orderOtaCtr/getFlightBgInfo',
      changeAvailability: '/apiOrder/ota/orderOtaCtr/getFlightBgApp',
      submitChange: '/apiOrder/ota/orderOtaCtr/submitFlightBgOTA',
      fareRules: '/weekApiFlightSearch/ota/flights/searchKeguiBySegId',
      accessToken: '/auth/oauth2/accessToken',
      refreshToken: '/auth/oauth2/refreshToken',
      orderDetail: 'getOrderDetailInfoC2 (XML/SOAP)'
    }
  };
}

export function createSpringClient(env = process.env) {
  const baseUrl = env.SPRING_HTTP_BASE_URL ? trimUrl(env.SPRING_HTTP_BASE_URL) : '';

  async function jsonRequest(path, payload, accessToken) {
    required(baseUrl, 'SPRING_HTTP_BASE_URL');
    required(accessToken, 'Spring access token');
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
        'accessToken': accessToken
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!response.ok) throw new Error(`Spring API ${path} failed (${response.status}).`);
    return data;
  }

  return {
    getAccessToken: () => {
      const appKey = required(env.SPRING_OAUTH_CLIENT_ID, 'SPRING_OAUTH_CLIENT_ID');
      const secret = required(env.SPRING_OAUTH_CLIENT_SECRET, 'SPRING_OAUTH_CLIENT_SECRET');
      required(baseUrl, 'SPRING_HTTP_BASE_URL');
      const grantType = 'SHA2';
      const timestamp = Date.now();
      const sign = createHash('md5').update(`${appKey}${grantType}${secret}${timestamp}${appKey}`, 'utf8').digest('hex').toUpperCase();
      return fetch(`${baseUrl}/auth/oauth2/accessToken`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ appKey, grantType, sign, timestamp })
      }).then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ifSuccess !== 'Y' || !data.oauth2ResultDTO?.accessToken) throw new Error(data.errMsg || `Spring token request failed (${response.status}).`);
        return data.oauth2ResultDTO;
      });
    },
    searchFlights: (payload, token) => jsonRequest('/weekApiFlightSearch/ota/flights/searchFlightsOtaDayKegui', payload, token),
    getSpecificPrice: (payload, token) => jsonRequest('/getSpecificPriceNew', payload, token),
    bookOrder: (payload, token) => jsonRequest('/apiOrder/ota/orderOtaCtr/bookOrderC', payload, token),
    calculateRefund: (payload, token) => jsonRequest('/apiOrder/ota/orderOtaCtr/calcRetTktFeeOTA', payload, token),
    refundTicket: (payload, token) => jsonRequest('/apiOrder/ota/orderOtaCtr/refundTicketB2cAgentOTA', payload, token),
    getChangeInfo: (payload, token) => jsonRequest('/apiOrder/ota/orderOtaCtr/getFlightBgInfo', payload, token),
    getChangeAvailability: (payload, token) => jsonRequest('/apiOrder/ota/orderOtaCtr/getFlightBgApp', payload, token),
    submitChange: (payload, token) => jsonRequest('/apiOrder/ota/orderOtaCtr/submitFlightBgOTA', payload, token),
    getFareRules: (payload, token) => jsonRequest('/weekApiFlightSearch/ota/flights/searchKeguiBySegId', payload, token)
  };
}
