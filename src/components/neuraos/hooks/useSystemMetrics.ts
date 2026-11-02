import { useEffect, useState } from "react";
import { getSystemMetrics, type SystemMetrics } from "../../../services/api";
const EMPTY:SystemMetrics={cpu:0,ram:0,gpu:0,temp:0,net:0,tokens:0,apiCalls:0,queue:0};
export function useSystemMetrics(){
 const [metrics,setMetrics]=useState<SystemMetrics>(EMPTY);
 useEffect(()=>{let alive=true;const refresh=()=>getSystemMetrics().then(v=>alive&&setMetrics(v)).catch(()=>{});
 refresh();const id=window.setInterval(refresh,3000);return()=>{alive=false;window.clearInterval(id)}},[]);
 return metrics;
}
