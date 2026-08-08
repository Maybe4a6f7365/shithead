import type { GameState,Player,Card } from '../engine'
import { initGame,rearrange,startPlay,playCards,pickUpPile } from '../engine'
import type { ClientMsg,ServerMsg,RoomSummary } from '../engine/protocol'
import { isClientMsg,serializeGameState,toPlayerSummary } from '../engine/protocol'
interface Env{ROOM:DurableObjectNamespace;ASSETS:Fetcher}
interface Session{webSocket:WebSocket;playerId:string|null}
interface Data{code:string;hostId:string;maxPlayers:number;players:Player[];state:GameState|null;createdAt:number}
const allowed=(o:string|null)=>!!o&&['https://shithead.not4a6f7365.workers.dev','https://shithead.pages.dev','https://shithead.maybe4a6f7365.workers.dev','http://localhost:5173','http://localhost:8787'].includes(o)
const mkPlayer=(name:string):Player=>({id:crypto.randomUUID(),name,isAI:false,hand:[],faceUp:[],faceDown:[],isOut:false})
export class Room{
 private sessions=new Map<string,Session>();private data:Data|null=null;private code=''
 constructor(private state:DurableObjectState,private env:Env){}
 async fetch(req:Request){const p=new URL(req.url).pathname,m=p.match(/^\/api\/room\/([A-Z0-9]{6})\/ws$/);if(m){this.code=m[1];if(!allowed(req.headers.get('Origin')))return new Response('Forbidden origin',{status:403});if(req.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('Upgrade required',{status:426});return this.ws()}return new Response('Not found',{status:404})}
 private ws(){const pair=new WebSocketPair(),client=pair[0],server=pair[1],sid=crypto.randomUUID();this.sessions.set(sid,{webSocket:server,playerId:null});server.accept();server.addEventListener('message',e=>this.msg(sid,String(e.data)));server.addEventListener('close',()=>this.close(sid));server.addEventListener('error',()=>this.close(sid));return new Response(null,{status:101,webSocket:client})}
 private msg(sid:string,raw:string){const s=this.sessions.get(sid);if(!s)return;let m:ClientMsg;try{const x=JSON.parse(raw);if(!isClientMsg(x))throw 0;m=x}catch{return this.send(s,{type:'ERROR',code:'INTERNAL',message:'Bad message'})}switch(m.type){case'CREATE_ROOM':return this.create(s,m.playerName,m.maxPlayers);case'JOIN_ROOM':return this.join(s,m.code,m.playerName);case'LEAVE_ROOM':return this.leave(s);case'START_GAME':return this.start(s);case'READY':return this.ready(s);case'REARRANGE':return this.swap(s,m.handIdx,m.upIdx);case'PLAY':return this.play(s,m.cards);case'PICK_UP':return this.pick(s);case'CHAT':return this.chat(s,m.text);case'PING':return this.send(s,{type:'PONG',ts:Date.now()})}}
 private create(s:Session,name:string,max=5){if(this.data)return this.send(s,{type:'ERROR',code:'INTERNAL',message:'Room already exists'});name=name.trim();if(!name||name.length>32)return this.send(s,{type:'ERROR',code:'INTERNAL',message:'Invalid name'});const p=mkPlayer(name);s.playerId=p.id;this.data={code:this.code,hostId:p.id,maxPlayers:Math.max(2,Math.min(5,max)),players:[p],state:null,createdAt:Date.now()};this.welcome(s);this.room()}
 private join(s:Session,code:string,name:string){const d=this.data;name=name.trim();if(!d||d.code!==code.toUpperCase())return this.send(s,{type:'ERROR',code:'INVALID_CODE',message:'Room not found'});if(!name||name.length>32)return this.send(s,{type:'ERROR',code:'INTERNAL',message:'Invalid name'});if(d.players.length>=d.maxPlayers)return this.send(s,{type:'ERROR',code:'ROOM_FULL',message:'Room full'});if(d.state)return this.send(s,{type:'ERROR',code:'INTERNAL',message:'Game already started'});const p=mkPlayer(name);s.playerId=p.id;d.players.push(p);this.welcome(s);this.room()}
 private start(s:Session){const d=this.data;if(!d||s.playerId!==d.hostId)return this.send(s,{type:'ERROR',code:'NOT_HOST',message:'Only host can start'});if(d.players.length<2)return this.send(s,{type:'ERROR',code:'INTERNAL',message:'Need 2 players'});d.state=initGame({players:d.players.map(p=>({id:p.id,name:p.name,isAI:false}))});this.game()}
 private ready(s:Session){if(!this.data?.state||!s.playerId)return;this.data.state=startPlay(this.data.state);this.game()}
 private swap(s:Session,h:number,u:number){if(!this.data?.state||!s.playerId)return;this.data.state=rearrange(this.data.state,s.playerId,h,u);this.game()}
 private play(s:Session,c:Card[]){if(!this.data?.state||!s.playerId)return;const r=playCards(this.data.state,s.playerId,c);if(r.error)return this.send(s,{type:'ERROR',code:'INVALID_MOVE',message:r.error});this.data.state=r.state;this.game()}
 private pick(s:Session){if(!this.data?.state||!s.playerId)return;const r=pickUpPile(this.data.state,s.playerId);if(r.error)return this.send(s,{type:'ERROR',code:'INVALID_MOVE',message:r.error});this.data.state=r.state;this.game()}
 private chat(s:Session,t:string){if(!s.playerId)return;const text=t.slice(0,200).replace(/[^\w\s!?.,-]/g,'');if(text)this.broadcast({type:'CHAT',playerId:s.playerId,text,ts:Date.now()})}
 private leave(s:Session){if(!this.data||!s.playerId)return;this.data.players=this.data.players.filter(p=>p.id!==s.playerId);if(this.data.hostId===s.playerId&&this.data.players[0])this.data.hostId=this.data.players[0].id;this.room();s.playerId=null}
 private close(id:string){this.sessions.delete(id);this.room()}
 private connected(id:string){return[...this.sessions.values()].some(s=>s.playerId===id)}
 private summary():RoomSummary{const d=this.data!;return{code:d.code,phase:d.state?.phase??'waiting',hostId:d.hostId,maxPlayers:d.maxPlayers,players:d.players.map(p=>toPlayerSummary(p,this.connected(p.id))),createdAt:d.createdAt}}
 private welcome(s:Session){this.send(s,{type:'WELCOME',playerId:s.playerId!,room:this.summary()})}
 private room(){if(this.data)this.broadcast({type:'ROOM_STATE',room:this.summary()})}
 private game(){const d=this.data;if(!d?.state)return;for(const s of this.sessions.values())if(s.playerId)this.send(s,{type:'GAME_STATE',state:serializeGameState(d.state,s.playerId)})}
 private send(s:Session,m:ServerMsg){try{s.webSocket.send(JSON.stringify(m))}catch{}}
 private broadcast(m:ServerMsg){for(const s of this.sessions.values())this.send(s,m)}
}
function code(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:6},()=>c[Math.floor(Math.random()*c.length)]).join('')}
function cors(o:string|null):HeadersInit{return{'Access-Control-Allow-Origin':allowed(o)&&o?o:'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}}
export default{async fetch(req:Request,env:Env){const u=new URL(req.url),p=u.pathname;if(req.method==='OPTIONS')return new Response(null,{headers:cors(req.headers.get('Origin'))});if(p==='/api/health')return new Response('OK',{headers:cors(req.headers.get('Origin'))});if(p==='/api/room/new'&&req.method==='POST')return Response.json({roomId:code()},{headers:cors(req.headers.get('Origin'))});const m=p.match(/^\/api\/room\/([A-Z0-9]{6})\/ws$/);if(m)return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);if(env.ASSETS){const r=await env.ASSETS.fetch(req);if(r.status!==404)return r;if(req.method==='GET'&&!p.startsWith('/api/'))return env.ASSETS.fetch(new Request(new URL('/index.html',req.url)))}return new Response('Not found',{status:404,headers:cors(req.headers.get('Origin'))})}}
