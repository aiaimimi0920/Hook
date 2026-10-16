import type { Unit } from "../types/unit";
import { unitUiState } from "../state/uiStore";
import { unitEndpointsVisible } from "../state/unitChromeState";

/** A reference line must not reveal a connection whose endpoint is hidden. */
export const unitLinkEndpointVisible = (unit: Unit | undefined): boolean => !!unit && unitEndpointsVisible(
    !unit.data.minified && !!unitUiState[unit.id]?.showParams,
    unit.data.hideCollapsedEndpoints,
);

export const unitLinkVisible = (source: Unit | undefined, target: Unit | undefined): boolean =>
    unitLinkEndpointVisible(source) && unitLinkEndpointVisible(target);
