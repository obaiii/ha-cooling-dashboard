const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const registry = new Map();
const context = vm.createContext({HTMLElement:class {}, customElements:{get:key=>registry.get(key),define:(key,value)=>registry.set(key,value)},window:{},console:{info(){}}});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../cooling-dashboard.js'),'utf8'),context);
const Card = registry.get('cooling-dashboard');
function setup(state='on', attributes={}) {
  const card=Object.create(Card.prototype),calls=[];
  const fan={state,attributes:{angle_low:158,angle_high:203,percentage:50,oscillating:true,...attributes}};
  card._hass={states:{'fan.example':fan},callService:async(domain,service,data)=>{
    calls.push({domain,service,data});
    if(service==='set_angle'){fan.attributes.angle_low=data.angle_low;fan.attributes.angle_high=data.angle_high;}
    if(service==='oscillate')fan.attributes.oscillating=data.oscillating;
  }};
  return {card,fan,calls};
}
test('sweep cycles through four physical ranges and wraps without turning off',async()=>{
  const {card,fan,calls}=setup();
  const actual=[];
  for(let i=0;i<4;i++){await card._cycleSweep({entity:'fan.example',sweep:{}});actual.push(fan.attributes.angle_high-fan.attributes.angle_low);}
  assert.deepEqual(actual,[90,180,350,45]);
  assert.ok(calls.every(call=>call.service==='set_angle'));
  assert.ok(calls.every(call=>call.data.angle_low>=5&&call.data.angle_high<=355));
});
test('changing sweep while stationary starts oscillation but keeps fan power unchanged',async()=>{
  const {card,fan,calls}=setup('on',{oscillating:false});
  await card._cycleSweep({entity:'fan.example',sweep:{}});
  assert.equal(fan.state,'on');assert.equal(fan.attributes.oscillating,true);
  assert.equal(calls.at(-1).service,'oscillate');
});
test('successive taps advance even before device telemetry catches up',async()=>{
  const {card,calls}=setup();
  card._hass.callService=async(domain,service,data)=>calls.push({domain,service,data});
  for(let i=0;i<4;i++)await card._cycleSweep({entity:'fan.example',sweep:{}});
  assert.deepEqual(calls.map(call=>call.data.angle_high-call.data.angle_low),[90,180,350,45]);
});
test('off fan rejects both speed and sweep actions',async()=>{
  const {card,calls}=setup('off');
  await card._cycleSweep({entity:'fan.example',sweep:{}});
  await card._setFanSpeed('fan.example',70);
  await card._toggleOscillation('fan.example');
  assert.equal(calls.length,0);
});
test('non-sweep fan keeps standard oscillation toggle',async()=>{
  const {card,fan,calls}=setup();await card._toggleOscillation('fan.example');
  assert.equal(fan.attributes.oscillating,false);assert.equal(calls[0].service,'oscillate');
});
test('AC target respects advertised limits',async()=>{
  const {card,calls}=setup();card._hass.states['climate.example']={state:'cool',attributes:{temperature:16,min_temp:16,max_temp:30}};
  await card._adjustTemperature('climate.example',-1);assert.equal(calls.length,0);
  await card._adjustTemperature('climate.example',0.5);assert.equal(calls[0].data.temperature,16.5);
});
test('power excludes boolean and missing values',()=>{
  const {card}=setup();assert.equal(card._power({}, {attributes:{compressor_power:null,power:true}}),null);
  assert.equal(card._power({}, {attributes:{compressor_power:1250,power:true}}),1250);
});
