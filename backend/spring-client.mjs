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
    httpJsonReady: Boolean((env.SPRING_TOKEN_URL || env.SPRING_HTTP_BASE_URL) && env.SPRING_OAUTH_CLIENT_ID && env.SPRING_OAUTH_CLIENT_SECRET),
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
  const endpoint = (variable, path) => env[variable] || `${required(baseUrl, 'SPRING_HTTP_BASE_URL')}${path}`;

  async function jsonRequest(url, payload, accessToken) {
    required(accessToken, 'Spring access token');
    const response = await fetch(url, {
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
    if (!response.ok) throw new Error(`Spring API request failed (${response.status}).`);
    return data;
  }

  return {
    getAccessToken: () => {
      const appKey = required(env.SPRING_OAUTH_CLIENT_ID, 'SPRING_OAUTH_CLIENT_ID');
      const secret = required(env.SPRING_OAUTH_CLIENT_SECRET, 'SPRING_OAUTH_CLIENT_SECRET');
      const grantType = 'SHA2';
      const timestamp = Date.now();
      const sign = createHash('md5').update(`${appKey}${grantType}${secret}${timestamp}${appKey}`, 'utf8').digest('hex').toUpperCase();
      return fetch(endpoint('SPRING_TOKEN_URL', '/auth/oauth2/accessToken'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ appKey, grantType, sign, timestamp })
      }).then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ifSuccess !== 'Y' || !data.oauth2ResultDTO?.accessToken) throw new Error(data.errMsg || `Spring token request failed (${response.status}).`);
        return data.oauth2ResultDTO;
      });
    },
    searchFlights: (payload, token) => jsonRequest(endpoint('SPRING_FLIGHT_SEARCH_URL', '/weekApiFlightSearch/ota/flights/searchFlightsOtaDayKegui'), payload, token),
    getSpecificPrice: (payload, token) => jsonRequest(endpoint('SPRING_PRICE_CHECK_URL', '/apiFlightSearch/ota/normalFlightSearch/getSpecificPriceNew'), payload, token),
    bookOrder: (payload, token) => jsonRequest(endpoint('SPRING_BOOK_ORDER_URL', '/apiOrder/ota/orderOtaCtr/bookOrderC'), payload, token),
    calculateRefund: (payload, token) => jsonRequest(endpoint('SPRING_CANCELLATION_FEE_URL', '/apiOrder/ota/orderOtaCtr/calcRetTktFeeOTA'), payload, token),
    refundTicket: (payload, token) => jsonRequest(endpoint('SPRING_REFUND_URL', '/apiOrder/ota/orderOtaCtr/refundTicketB2cAgentOTA'), payload, token),
    getChangeInfo: (payload, token) => jsonRequest(endpoint('SPRING_CHANGE_INFO_URL', '/apiOrder/ota/orderOtaCtr/getFlightBgInfo'), payload, token),
    getChangeAvailability: (payload, token) => jsonRequest(endpoint('SPRING_CHANGE_AVAILABILITY_URL', '/apiOrder/ota/orderOtaCtr/getFlightBgApp'), payload, token),
    submitChange: (payload, token) => jsonRequest(endpoint('SPRING_SUBMIT_CHANGE_URL', '/apiOrder/ota/orderOtaCtr/submitFlightBgOTA'), payload, token),
    getFareRules: (payload, token) => jsonRequest(endpoint('SPRING_FARE_RULES_URL', '/apiFlightSearch/ota/flights/searchKeguiBySegId'), payload, token)
  };
}
