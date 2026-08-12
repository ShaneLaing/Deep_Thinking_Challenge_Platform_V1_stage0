const UTF8 = new TextEncoder();
const PATH_SUFFIX = '/student/tasks/T0001/submit';

function requestId() { return crypto.randomUUID(); }
function joinUrl(base, suffix = '') { return `${base.replace(/\/$/, '')}${suffix}`; }
function bytesLength(text) { return UTF8.encode(text).byteLength; }
async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', UTF8.encode(text));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
function result(id, expected, passed, actual, status = passed ? 'PASS' : 'FAIL') {
  return { id, expected, actual, status };
}
async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  return { response, json: JSON.parse(text) };
}
function postBody(payload) { return JSON.stringify({ probe: 'echo', request_id: requestId(), payload }); }
async function postEcho(execUrl, payload, suffix = '', contentType = 'text/plain;charset=utf-8', headers = {}) {
  const body = postBody(payload);
  const data = await fetchJson(joinUrl(execUrl, suffix), {
    method: 'POST', mode: 'cors', redirect: 'follow',
    headers: { 'Content-Type': contentType, ...headers }, body
  });
  return { ...data, body };
}
async function expectedPreflightFailure(id, execUrl, options) {
  try {
    const response = await fetch(execUrl, options);
    return result(id, '瀏覽器 preflight 失敗', false, `UNEXPECTED_PASS：HTTP ${response.status}`, 'UNEXPECTED_PASS');
  } catch (error) {
    return result(id, '瀏覽器 preflight 失敗', true, `EXPECTED_FAIL：${error.name}`, 'EXPECTED_FAIL');
  }
}

async function testT1(execUrl) {
  try {
    const { response, json } = await fetchJson(`${execUrl}?probe=echo`, { mode: 'cors', redirect: 'follow' });
    const ok = response.type !== 'opaque' && response.ok && json.data.handler_confirmed === 'doGet';
    return result('T1', '可讀取 doGet JSON，非 opaque', ok, ok ? 'doGet JSON 可讀取' : '未符合 CORS/回應契約');
  } catch (error) { return result('T1', '可讀取 doGet JSON，非 opaque', false, `${error.name}: ${error.message}`); }
}
async function testT2AndT3(execUrl) {
  try {
    const basic = await postEcho(execUrl, { sentinel: 'stage0-sentinel' });
    const ok = basic.json.data.handler_confirmed === 'doPost';
    const expectedHash = await sha256(basic.body);
    const data = basic.json.data;
    const hashOk = data.body_sha256 === expectedHash && data.body_byte_length === bytesLength(basic.body);
    return [result('T2', 'text/plain POST 到 doPost', ok, data.handler_confirmed || '缺少 handler_confirmed'), result('T3', 'UTF-8 SHA-256 與 byte length 完整一致', hashOk, `sha=${data.body_sha256}; bytes=${data.body_byte_length}`)];
  } catch (error) {
    return [result('T2', 'text/plain POST 到 doPost', false, `${error.name}: ${error.message}`), result('T3', 'UTF-8 SHA-256 與 byte length 完整一致', false, 'T2 無法取得送出 body')];
  }
}
async function testT4(execUrl) {
  try {
    const [one, two] = await Promise.all([postEcho(execUrl, { sentinel: 'nonce-1' }), postEcho(execUrl, { sentinel: 'nonce-2' })]);
    const ok = one.json.server_nonce && two.json.server_nonce && one.json.server_nonce !== two.json.server_nonce;
    return result('T4', '兩次 server_nonce 必須不同', ok, `${one.json.server_nonce} / ${two.json.server_nonce}`);
  } catch (error) { return result('T4', '兩次 server_nonce 必須不同', false, `${error.name}: ${error.message}`); }
}
async function testT5(execUrl) {
  try {
    const { json } = await postEcho(execUrl, { sentinel: 'path' }, PATH_SUFFIX);
    const ok = json.data.path_info === 'student/tasks/T0001/submit';
    return result('T5', 'path_info 為 student/tasks/T0001/submit', ok, json.data.path_info || '(空)');
  } catch (error) { return result('T5', 'pathInfo 正確路由', false, `${error.name}: ${error.message}`); }
}
async function testT6(execUrl) {
  try {
    const { json } = await postEcho(execUrl, { auth: 'body-token-for-stage0', sentinel: 'auth' });
    return result('T6', 'body token 被 GAS 看見', json.data.auth_seen_in_body === true, String(json.data.auth_seen_in_body));
  } catch (error) { return result('T6', 'body token 被 GAS 看見', false, `${error.name}: ${error.message}`); }
}
async function testT9(execUrl) {
  try {
    const large = `中文😀${'x'.repeat(32 * 1024)}`;
    const response = await postEcho(execUrl, { sentinel: large });
    const ok = response.json.data.body_sha256 === await sha256(response.body) && response.json.data.body_byte_length === bytesLength(response.body);
    return result('T9', '約 32KB Unicode body 未截斷', ok, `bytes=${response.json.data.body_byte_length}`);
  } catch (error) { return result('T9', '約 32KB Unicode body 未截斷', false, `${error.name}: ${error.message}`); }
}
async function testT10(execUrl) {
  try {
    const { json } = await fetchJson(`${execUrl}?probe=whoami`, { mode: 'cors', redirect: 'follow' });
    const active = json.data.active_user_present;
    return result('T10', 'active_user_present === false', active === false, active ? 'true；請改用無登入的瀏覽器模式（無痕視窗）重測' : 'false');
  } catch (error) { return result('T10', 'active_user_present === false', false, `${error.name}: ${error.message}`); }
}
export async function runCorsMatrix(execUrl) {
  const preflightBody = postBody({ sentinel: 'preflight' });
  const tests = [await testT1(execUrl), ...(await testT2AndT3(execUrl)), await testT4(execUrl), await testT5(execUrl), await testT6(execUrl)];
  tests.push(await expectedPreflightFailure('T7', execUrl, { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' }, body: preflightBody }));
  tests.push(await expectedPreflightFailure('T8', execUrl, { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'text/plain;charset=utf-8', Authorization: 'Bearer stage0' }, body: preflightBody }));
  tests.push(await testT9(execUrl), await testT10(execUrl));
  const passed = tests.filter((test) => test.status === 'PASS').length;
  return { generated_at: new Date().toISOString(), exec_url: execUrl, user_agent: navigator.userAgent, origin: location.origin, tests, summary: { passed, total: tests.length, expectedFails: tests.filter((test) => test.status === 'EXPECTED_FAIL').length } };
}
