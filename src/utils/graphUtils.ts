import { Unit } from "../types/unit";
import { ArtCapability } from "../services/protocol";

/**
 * Calculates the Y position of a port on a unit.
 * Used for rendering links and drag interactions.
 */
export const calculatePortY = (u: Unit, portName: string, isInput: boolean, capabilities: ArtCapability[]): number => {
    let index = 0;
    let count = 1;

    if (u.type === 'art') {
         const cap = capabilities.find(c => c.id === u.artId);
         if (cap) {
             const ports = isInput ? cap.inputs : cap.outputs;
             const found = ports?.findIndex(p => p.name === portName);
             if (found !== undefined && found !== -1) index = found;
             if (ports) count = ports.length || 1;
         }
    } else {
         // Stickers: Single Input/Output (Index 0)
         index = 0;
         count = 1;
    }

    // Formulae
    if (u.data.minified) {
        // Minified: Equidistant spread over full height
        const step = u.h / count;
        return u.y + (index * step) + (step / 2);
    } else {
        // Normal: Fixed 24px items with 12px gap, top padding 24
        // Top Padding 24 + (Item Height 24 + Gap 12) * index + Half Item 12
        // = 36 + index * 36
        return u.y + 36 + (index * 36);
    }
};
