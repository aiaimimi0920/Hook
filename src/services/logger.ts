/**
 * Simple Logger wrapper to control verbosity and prefix logs
 */

const LOG_PREFIX = "[Hook]";

export const logger = {
    info: (...args: any[]) => {
        if (import.meta.env.DEV) {
            console.log(LOG_PREFIX, ...args);
        }
    },
    warn: (...args: any[]) => {
        console.warn(LOG_PREFIX, ...args);
    },
    error: (...args: any[]) => {
        console.error(LOG_PREFIX, ...args);
    },
    debug: (...args: any[]) => {
        if (import.meta.env.DEV) {
            console.debug(LOG_PREFIX, ...args);
        }
    }
};
