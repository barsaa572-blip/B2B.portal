import http from 'node:http';
import https from 'node:https';

const xmlEscape = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const xmlDecode = value => String(value ?? '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

const xmlValue = (xml, tag) => {
  const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}>`, 'i').exec(String(xml));
  return match ? xmlDecode(match[1].replace(/<[^>]*>/g, '').trim()) : null;
};

const xmlValues = (xml, tag) => {
  const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${escaped}>`, 'ig');
  return Array.from(String(xml).matchAll(matcher), match => xmlDecode(match[1].replace(/<[^>]*>/g, '').trim()));
};

const serviceEndpoint = wsdlUrl => String(wsdlUrl || '').trim().replace(/[?&]wsdl(?:=[^&]*)?$/i, '');
const finiteNumber = value => {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

// Spring's legacy JAX-WS service resets some chunked requests sent by undici
// (the transport behind Node's fetch).  Use the native HTTP client so this
// SOAP request is HTTP/1.1 with an explicit Content-Length, just like the
// supplier's XML demo.
const postSoapXml = (endpoint, xml) => new Promise((resolve, reject) => {
  const url = new URL(endpoint);
  const transport = url.protocol === 'https:' ? https : http;
  const request = transport.request({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || undefined,
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      Accept: 'text/xml, application/xml, */*',
      SOAPAction: '""',
      'Content-Length': Buffer.byteLength(xml, 'utf8'),
      Connection: 'close'
    },
    timeout: 30_000
  }, response => {
    let responseXml = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { responseXml += chunk; });
    response.on('end', () => resolve({ status: response.statusCode || 0, ok: (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300, text: responseXml }));
  });
  request.once('timeout', () => request.destroy(new Error('SOAP request timed out.')));
  request.once('error', reject);
  request.end(xml, 'utf8');
});

export function getSpringSoapStatus(env = process.env) {
  const endpoint = serviceEndpoint(env.SPRING_ORDER_DETAIL_WSDL_URL || env.SPRING_CREDIT_PAYMENT_WSDL_URL || env.SPRING_XML_WSDL_URL);
  const configured = Boolean(endpoint && env.SPRING_XML_USERNAME && env.SPRING_XML_PASSWORD);
  const enabled = env.SPRING_CREDIT_PAYMENT_ENABLED === 'true';
  return {
    creditPaymentEnabled: enabled,
    creditPaymentReady: enabled && configured,
    creditPayment: 'payInCredit4OTA (XML/SOAP)',
    orderDetailReady: configured,
    orderDetail: 'getOrderDetailInfoC2 (XML/SOAP)'
  };
}

export function createSpringSoapClient(env = process.env) {
  const endpoint = serviceEndpoint(env.SPRING_ORDER_DETAIL_WSDL_URL || env.SPRING_CREDIT_PAYMENT_WSDL_URL || env.SPRING_XML_WSDL_URL);
  const username = String(env.SPRING_XML_USERNAME || '').trim();
  const password = String(env.SPRING_XML_PASSWORD || '').trim();

  async function payInCredit4OTA({ orderNo, orderMoney, moneyClassId = 0, orderType = 0 }) {
    if (env.SPRING_CREDIT_PAYMENT_ENABLED !== 'true') {
      throw new Error('Spring credit payment is disabled on this server.');
    }
    if (!endpoint || !username || !password) {
      throw new Error('Spring XML credit-payment configuration is incomplete on this server.');
    }
    const money = finiteNumber(orderMoney);
    const currencyId = finiteNumber(moneyClassId);
    const type = finiteNumber(orderType);
    if (!String(orderNo || '').trim() || money === null || money < 0 || currencyId === null || type === null) {
      throw new Error('A valid Spring order number, amount, currency and order type are required.');
    }

    const body = `<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n    <i:payInCredit4OTA xmlns:i="http://wsinterface.remoteservice.booking.springairlines.com/">\n      <paymentInfo>\n        <usernameToken><password>${xmlEscape(password)}</password><username>${xmlEscape(username)}</username></usernameToken>\n        <moneyClassId>${currencyId}</moneyClassId>\n        <orderMoney>${money}</orderMoney>\n        <orderNo>${xmlEscape(String(orderNo).trim())}</orderNo>\n        <orderType>${type}</orderType>\n      </paymentInfo>\n    </i:payInCredit4OTA>\n  </soap:Body>\n</soap:Envelope>`;

    let response;
    try {
      response = await postSoapXml(endpoint, body);
    } catch (error) {
      // Keep the browser message useful without exposing the SOAP body, XML
      // credentials, or any part of the request payload.
      const detail = error?.cause?.message || error?.message || 'connection failed';
      throw new Error(`Spring credit payment network request failed: ${detail}`);
    }

    const responseXml = response.text;
    const result = {
      ifSuccess: xmlValue(responseXml, 'ifSuccess'),
      errCode: xmlValue(responseXml, 'errCode'),
      errMsg: xmlValue(responseXml, 'errMsg') || xmlValue(responseXml, 'message') || xmlValue(responseXml, 'faultstring')
    };
    if (!response.ok || result.ifSuccess !== 'Y') {
      // Keep the SOAP response in the server journal only.  It contains no
      // request credentials, and lets us see Spring's exact business error.
      console.warn('Spring credit payment rejected', {
        httpStatus: response.status,
        ifSuccess: result.ifSuccess,
        errCode: result.errCode,
        errMsg: result.errMsg,
        response: String(responseXml).slice(0, 6000)
      });
      const detail = result.errMsg || `Spring credit payment failed (${response.status}).`;
      throw new Error(`Spring credit payment failed${result.errCode ? ` (${result.errCode})` : ''}: ${detail}`);
    }
    return result;
  }

  async function getOrderDetailInfoC2({ orderNo, lang = 'zh_cn' }) {
    if (!endpoint || !username || !password) {
      throw new Error('Spring XML order-detail configuration is incomplete on this server.');
    }
    const reference = String(orderNo || '').trim();
    if (!reference) throw new Error('A Spring order number is required for order detail lookup.');

    const body = `<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n    <i:getOrderDetailInfoC2 xmlns:i="http://wsinterface.remoteservice.booking.springairlines.com/">\n      <queryInfo>\n        <usernameToken><password>${xmlEscape(password)}</password><username>${xmlEscape(username)}</username></usernameToken>\n        <lang>${xmlEscape(lang)}</lang>\n        <orderNo>${xmlEscape(reference)}</orderNo>\n      </queryInfo>\n    </i:getOrderDetailInfoC2>\n  </soap:Body>\n</soap:Envelope>`;

    let response;
    try {
      response = await postSoapXml(endpoint, body);
    } catch (error) {
      const detail = error?.cause?.message || error?.message || 'connection failed';
      throw new Error(`Spring order-detail network request failed: ${detail}`);
    }

    const responseXml = response.text;
    const result = {
      ifSuccess: xmlValue(responseXml, 'ifSuccess'),
      errCode: xmlValue(responseXml, 'errCode'),
      errMsg: xmlValue(responseXml, 'errMsg') || xmlValue(responseXml, 'message') || xmlValue(responseXml, 'faultstring'),
      orderHeadIds: [...new Set(xmlValues(responseXml, 'orderHeadId').map(Number).filter(value => Number.isSafeInteger(value) && value > 0))]
    };
    if (!response.ok || result.ifSuccess !== 'Y') {
      console.warn('Spring order-detail lookup rejected', {
        httpStatus: response.status,
        ifSuccess: result.ifSuccess,
        errCode: result.errCode,
        errMsg: result.errMsg,
        response: String(responseXml).slice(0, 6000)
      });
      throw new Error(`Spring order-detail lookup failed${result.errCode ? ` (${result.errCode})` : ''}: ${result.errMsg || `HTTP ${response.status}`}`);
    }
    if (!result.orderHeadIds.length) {
      console.warn('Spring order-detail response contains no orderHeadId', { response: String(responseXml).slice(0, 6000) });
      throw new Error('Spring order detail did not return an orderHeadId for this PNR.');
    }
    return result;
  }

  return { payInCredit4OTA, getOrderDetailInfoC2 };
}
