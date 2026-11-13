import { registerLocaleStrings } from '../../i18n';
import { strings } from './strings';
import { DocumentPip, documentPipApi, type DocumentPipContext } from './DocumentPip';

registerLocaleStrings(strings);

export function installDocumentPip(ctx: DocumentPipContext): DocumentPip {
    return new DocumentPip(ctx);
}

export { DocumentPip, documentPipApi };
export type { DocumentPipContext };
