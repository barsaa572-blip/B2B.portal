/**
 * Server-only Spring Airlines integration boundary.
 * Browser code must never import this module or receive its credentials.
 */
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
      flightSearch: '/ota/flights/searchFlightsOtaDayKegui',
      priceCheck: '/getSpecificPriceNew',
      createOrder: '/ota/orderOtaCtr/bookOrderC',
      cancellationFee: '/ota/orderOtaCtr/calcRetTktFeeOTA',
      refund: '/ota/orderOtaCtr/refundTicketB2cAgentOTA',
      changeInfo: '/ota/orderOtaCtr/getFlightBgInfo',
      changeAvailability: '/ota/orderOtaCtr/getFlightBgApp',
      submitChange: '/ota/orderOtaCtr/submitFlightBgOTA',
      fareRules: '/ota/flights/searchKeguiBySegId',
      accessToken: '/oauth2/accessToken',
      refreshToken: '/oauth2/refreshToken',
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
      // Exact OAuth request fields are intentionally added only from Spring's test example.
      required(env.SPRING_OAUTH_CLIENT_ID, 'SPRING_OAUTH_CLIENT_ID');
      required(env.SPRING_OAUTH_CLIENT_SECRET, 'SPRING_OAUTH_CLIENT_SECRET');
      required(baseUrl, 'SPRING_HTTP_BASE_URL');
      throw new Error('OAuth request format is awaiting the Spring test example.');
    },
    searchFlights: (payload, token) => jsonRequest('/ota/flights/searchFlightsOtaDayKegui', payload, token),
    getSpecificPrice: (payload, token) => jsonRequest('/getSpecificPriceNew', payload, token),
    bookOrder: (payload, token) => jsonRequest('/ota/orderOtaCtr/bookOrderC', payload, token),
    calculateRefund: (payload, token) => jsonRequest('/ota/orderOtaCtr/calcRetTktFeeOTA', payload, token),
    refundTicket: (payload, token) => jsonRequest('/ota/orderOtaCtr/refundTicketB2cAgentOTA', payload, token),
    getChangeInfo: (payload, token) => jsonRequest('/ota/orderOtaCtr/getFlightBgInfo', payload, token),
    getChangeAvailability: (payload, token) => jsonRequest('/ota/orderOtaCtr/getFlightBgApp', payload, token),
    submitChange: (payload, token) => jsonRequest('/ota/orderOtaCtr/submitFlightBgOTA', payload, token),
    getFareRules: (payload, token) => jsonRequest('/ota/flights/searchKeguiBySegId', payload, token)
  };
}
