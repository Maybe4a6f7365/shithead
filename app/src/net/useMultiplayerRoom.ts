import { useEffect,useRef,useState } from 'react'
import type { ClientMsg,ServerMsg,RoomSummary } from '../engine/protocol'
import type { GameState } from '../engine'
import { RoomClient,buildRoomWSUrl,getDefaultServerURL } from './RoomClient'
export type ConnectionStatus='idle'|'connecting'|'connected'|'disconnected'|'error'
export function useMultiplayerRoom(roomId:string|null){
 const[status,setStatus]=useState<ConnectionStatus>('idle'),[room,setRoom]=useState<RoomSummary|null>(null),[gameState,setGameState]=useState<GameState|null>(null),[error,setError]=useState<string|null>(null),[playerId,setPlayerId]=useState<string|null>(null),[chat,setChat]=useState<Array<{playerId:string;text:string;ts:number}>>([]);const clientRef=useRef<RoomClient|null>(null)
 useEffect(()=>{if(!roomId)return;setStatus('connecting');setError(null);const client=new RoomClient({url:buildRoomWSUrl(getDefaultServerURL(),roomId),onOpen:()=>setStatus('connected'),onClose:e=>{setStatus('disconnected');if(e.reason)setError(e.reason)},onError:()=>{setStatus('error');setError('WebSocket connection failed')},onMessage:(msg:ServerMsg)=>{switch(msg.type){case'WELCOME':setPlayerId(msg.playerId);setRoom(msg.room);break;case'ROOM_STATE':setRoom(msg.room);break;case'GAME_STATE':setGameState(msg.state);break;case'ERROR':setError(msg.message);break;case'CHAT':setChat(p=>[...p,{playerId:msg.playerId,text:msg.text,ts:msg.ts}].slice(-50));break}}});clientRef.current=client;return()=>{client.close();clientRef.current=null}},[roomId])
 const send=(msg:ClientMsg)=>clientRef.current?.send(msg)
 return{status,room,gameState,error,chat,playerId,send}
}
export async function createRoom():Promise<string>{const url=`${getDefaultServerURL()}/api/room/new`;let resp:Response;try{resp=await fetch(url,{method:'POST',headers:{Accept:'application/json'}})}catch{throw new Error('Room service is unreachable. Please retry.')}if(!resp.ok){const detail=await resp.text().catch(()=>'');throw new Error(`Failed to create room (${resp.status})${detail?`: ${detail.slice(0,120)}`:''}`)}const body=await resp.json() as{roomId?:string};if(!body.roomId||!/^[A-Z0-9]{6}$/.test(body.roomId))throw new Error('Room service returned an invalid room code');return body.roomId}
