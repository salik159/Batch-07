import { useEffect, useState } from "react";
import { getSystemMetrics } from "../../../services/api";

export function useSystemMetrics() {

    const [metrics, setMetrics] = useState({
        cpu:0,
        ram:0,
        gpu:0,
        temp:0,
        net:0
    });

    useEffect(() => {

        getSystemMetrics()
            .then(setMetrics)
            .catch(console.error);

    }, []);

    return metrics;
}