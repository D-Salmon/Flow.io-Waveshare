const assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.resolve(__dirname,'../../data/webinterface/app.js'),'utf8');
const a=app.indexOf('    function networkAddressRows('), b=app.indexOf('    function refreshAppHeaderClock(',a);
function node(){return {children:[],className:'',textContent:'',setAttribute(){},replaceChildren(){this.children=[]},appendChild(el){this.children.push(el)}};}
const elements={networkAddresses:node(),dashboardNetworkAddresses:node()};
const cache={wifi:{data:{wifi:{ethernet_ip:'192.168.1.10',wifi_ip:'192.168.1.20',ap_ip:'192.168.4.1'}}},mqtt:{data:{mqtt:{rdy:true}}}};
const context={flowStatusDomainCache:cache,normalizeIpValue:x=>x||'-',document:{getElementById:id=>elements[id],createElement:node}};
vm.createContext(context); vm.runInContext(app.slice(a,b)+';renderNetworkAddresses();',context);
for(const root of Object.values(elements)) {assert.equal(root.children.length,4); for(const row of root.children)assert.match(row.children[0].className,/is-connected/);assert.match(root.children[2].children[1].textContent,/MQTT : Connecté/);}
cache.wifi.data.wifi={ethernet_ip:'0.0.0.0',wifi_ip:'192.168.1.20',ap_ip:'0.0.0.0'};cache.mqtt.data.mqtt.rdy=false;
vm.runInContext('renderNetworkAddresses()',context);
for(const root of Object.values(elements)){assert.equal(root.children.length,3);assert.match(root.children[0].children[0].className,/is-disconnected/);assert.match(root.children[1].children[0].className,/is-connected/);assert.match(root.children[2].children[0].className,/is-disconnected/);assert(!root.children.some(row=>/Prioritaire|Secours|Connexion utilisée|point d’accès/.test(row.children[1].textContent)));}
console.log('Network summary: Ethernet/Wi-Fi/MQTT status dots, optional AP, simplified labels passed');

cache.wifi.fetchedAt=20;cache.mqtt.fetchedAt=10;cache.wifi.data.mqtt={rdy:true};
vm.runInContext('renderNetworkAddresses()',context);
assert.match(elements.networkAddresses.children[2].children[1].textContent,/MQTT : Connecté/);

const informationStart=app.indexOf('    function networkInformationRows(');
vm.runInContext(app.slice(informationStart,a),context);
context.tr=(key,fallback)=>fallback;
vm.runInContext("globalThis.infoRows=networkInformationRows(flowStatusDomainCache.wifi.data.wifi,'Wifi')",context);
assert.deepEqual(Array.from(context.infoRows,row=>row[0]),['IP Ethernet','IP Wi-Fi','Type réseau','MQTT']);
assert.equal(context.infoRows.filter(row=>row[0]==='MQTT').length,1);
console.log('Information rows: no duplicate IP, network type before the single MQTT status passed');
