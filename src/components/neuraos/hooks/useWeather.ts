import { useEffect,useState } from "react";
import { getWeather,type WeatherData } from "../../../services/api";
const FALLBACK:WeatherData={temp:24,desc:"Clear Skies",city:"HYDERABAD, IN",wind:8,humidity:46};
export function useWeather(){const [weather,setWeather]=useState(FALLBACK);useEffect(()=>{let alive=true;const refresh=()=>getWeather().then(v=>alive&&setWeather(v)).catch(()=>{});refresh();const id=window.setInterval(refresh,600000);return()=>{alive=false;window.clearInterval(id)}},[]);return weather;}
