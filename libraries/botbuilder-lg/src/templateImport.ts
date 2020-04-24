/**
 * @module botbuilder-lg
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { SourceRange } from './sourceRange';

/**
 * Here is a data model that can help users understand and use the LG import definition in LG files easily. 
 */
export class TemplateImport {

    /**
     * Description of the import, what's included by '[]' in a lg file.
     */
    public description: string;

    /**
     * Id of this import.
     */
    public id: string;

    /**
     * origin root source of the import.
     */
    public sourceRange: SourceRange;

    public constructor(description: string, id: string, sourceRange: SourceRange) {
        this.description = description;
        this.sourceRange = sourceRange;
        this.id = id;
    }

    public toString = (): string => `[${ this.description }](${ this.id })`
}
