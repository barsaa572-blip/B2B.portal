import http from 'node:http';
import https from 'node:https';
import { springEndpoint, springEnabled, requireSpringEnabled } from './supplier-transport.mjs';

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

// Keep the XML for a nested object when an order contains more than one
// passenger or segment.  `xmlValue` intentionally flattens child tags, which
// is useful for simple fields but would lose the relationship between an
// orderHeadId and its flight route.
const xmlBlocks = (xml, tag) => {
  const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}\\b[^>]*>[\\s\\S]*?<\\/(?:[\\w.-]+:)?${escaped}>`, 'ig');
  return Array.from(String(xml).matchAll(matcher), match => match[0]);
};

const serviceEndpoint = wsdlUrl => String(wsdlUrl || '').trim().replace(/[?&]wsdl(?:=[^&]*)?$/i, '');
const finiteNumber = value => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

// Spring's legacy JAX-WS service resets some chunked requests sent by undici
// (the transport behind Node's fetch).  Use the native HTTP client so this
// SOAP request is HTTP/1.1 with an explicit Content-Length, just like the
// supplier's XML demo.
const postSoapXml = (endpoint, xml, env) => new Promise((resolve, reject) => {
  const url = new URL(springEndpoint(endpoint, env));
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
    let bytes = 0;
    response.setEncoding('utf8');
    response.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 4 * 1024 * 1024) { request.destroy(new Error('SOAP response exceeds size limit.')); return; }
      responseXml += chunk;
    });
    response.once('error', reject);
    response.on('end', () => resolve({ status: response.statusCode || 0, ok: (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300, text: responseXml }));
  });
  // Bound total duration too, not just socket inactivity, so worker leases
  // cannot expire while a trickling response is still being processed.
  const deadline = setTimeout(() => request.destroy(new Error('SOAP request timed out.')), 30_000);
  request.once('close', () => clearTimeout(deadline));
  request.once('timeout', () => request.destroy(new Error('SOAP request timed out.')));
  request.once('error', reject);
  request.end(xml, 'utf8');
});

export function getSpringSoapStatus(env = process.env) {
  const endpoint = serviceEndpoint(env.SPRING_ORDER_DETAIL_WSDL_URL || env.SPRING_CREDIT_PAYMENT_WSDL_URL || env.SPRING_XML_WSDL_URL);
  const configured = springEnabled(env) && Boolean(endpoint && env.SPRING_XML_USERNAME && env.SPRING_XML_PASSWORD);
  const enabled = springEnabled(env) && env.SPRING_CREDIT_PAYMENT_ENABLED === 'true';
  return {
    creditPaymentEnabled: enabled,
    creditPaymentReady: enabled && configured,
    creditPayment: 'payInCredit4OTA (XML/SOAP)',
    orderDetailReady: configured,
    orderDetail: 'getOrderDetailInfoC2 (XML/SOAP)'
  };
}

export function createSpringSoapClient(env = process.env) {
  requireSpringEnabled(env);
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

    // The legacy SOAP service deserializes its bean fields in the sequence
    // defined by the WSDL.  Do not rearrange these tags: if `orderNo` appears
    // where `orderMoney` is expected Spring attempts to parse a PNR as a
    // number (e.g. "For input string: BAARWUB").
    const body = `<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n    <i:payInCredit4OTA xmlns:i="http://wsinterface.remoteservice.booking.springairlines.com/">\n      <paymentInfo>\n        <usernameToken><password>${xmlEscape(password)}</password><username>${xmlEscape(username)}</username></usernameToken>\n        <orderType>${type}</orderType>\n        <orderNo>${xmlEscape(String(orderNo).trim())}</orderNo>\n        <orderMoney>${money}</orderMoney>\n        <moneyClassId>${currencyId}</moneyClassId>\n      </paymentInfo>\n    </i:payInCredit4OTA>\n  </soap:Body>\n</soap:Envelope>`;

    let response;
    try {
      response = await postSoapXml(endpoint, body, env);
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
      // A supplier can reflect credentials/passenger data in an error response.
      // Never journal raw XML or free-text supplier errors.
      console.warn('Spring credit payment rejected', {
        httpStatus: response.status,
        ifSuccess: ['Y', 'N'].includes(result.ifSuccess) ? result.ifSuccess : 'unknown',
        errCode: /^[A-Z]{0,8}-?\d{1,6}$/.test(result.errCode || '') ? result.errCode : 'SUPPLIER_ERROR'
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
      response = await postSoapXml(endpoint, body, env);
    } catch (error) {
      const detail = error?.cause?.message || error?.message || 'connection failed';
      throw new Error(`Spring order-detail network request failed: ${detail}`);
    }

    const responseXml = response.text;
    const orderHeads = parseOrderTicketStatuses(responseXml);
    const result = {
      ifSuccess: xmlValue(responseXml, 'ifSuccess'),
      errCode: xmlValue(responseXml, 'errCode'),
      errMsg: xmlValue(responseXml, 'errMsg') || xmlValue(responseXml, 'message') || xmlValue(responseXml, 'faultstring'),
      orderHeads,
      orderHeadIds: [...new Set(orderHeads.map(item => item.orderHeadId).concat(xmlValues(responseXml, 'orderHeadId').map(Number)).filter(value => Number.isSafeInteger(value) && value > 0))],
      // The supplier amount, never a browser estimate, authorizes payment.
      orderMoneyCny: finiteNumber(xmlValue(responseXml, 'orderMoney'))
    };
    if (!response.ok || result.ifSuccess !== 'Y') {
      // These responses can contain passport details; never log raw XML.
      console.warn('Spring order-detail lookup rejected', { httpStatus: response.status });
      throw new Error(`Spring order-detail lookup failed${result.errCode ? ` (${result.errCode})` : ''}: ${result.errMsg || `HTTP ${response.status}`}`);
    }
    if (!result.orderHeadIds.length) {
      throw new Error('Spring order detail did not return an orderHeadId for this PNR.');
    }
    return result;
  }

  return { payInCredit4OTA, getOrderDetailInfoC2 };
}

export function parseOrderTicketStatuses(responseXml) {
  return xmlBlocks(responseXml, 'ticketList').map(ticket => {
      const flight = xmlBlocks(ticket, 'flightBasicInfo')[0] || '';
      const origin = xmlBlocks(flight, 'oriEndPoint')[0] || '';
      const destination = xmlBlocks(flight, 'destEndPoint')[0] || '';
      const originAirport = xmlBlocks(origin, 'airportCityInfo')[0] || '';
      const destinationAirport = xmlBlocks(destination, 'airportCityInfo')[0] || '';
      return {
        orderHeadId: finiteNumber(xmlValue(ticket, 'orderHeadId')),
        tktFlag: finiteNumber(xmlValue(ticket, 'tktFlag')),
        // Missing identity is deliberately left unmatched, never positional.
        passengerDocument: xmlValue(ticket, 'cardNo') || xmlValue(ticket, 'documentNumber'),
        departureCode: xmlValue(originAirport, 'airportCode') || xmlValue(originAirport, 'cityCode'),
        arrivalCode: xmlValue(destinationAirport, 'airportCode') || xmlValue(destinationAirport, 'cityCode'),
        flightNo: xmlValue(flight, 'flightNo'),
        departureTime: xmlValue(xmlBlocks(origin, 'oriTimeInfo')[0] || '', 'timeBJ'),
        arrivalTime: xmlValue(xmlBlocks(destination, 'destTimeInfo')[0] || '', 'timeBJ')
      };
    }).filter(item => Number.isSafeInteger(item.orderHeadId) && item.orderHeadId > 0);
}
