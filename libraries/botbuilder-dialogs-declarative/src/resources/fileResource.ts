/**
 * @module botbuilder-dialogs-declarative
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { IResource } from './resource';

import fs = require('fs');

export class FileResource implements IResource {

    private resourceId: string;
    private path: string;

    public constructor(path: string) {
        if (!path) {
            throw new Error('path');
        }

        this.path = path;

        // The id will be the file name, without the path
        this.resourceId = this.path.replace(/^.*[\\\/]/, '');
    }

    public get fullName(): string {
        return this.path;
    }

    public id(): string {
        return this.resourceId;
    }

    public readText(): string {
        const filePath = this.path;
        const temp = fs.readFileSync(filePath, 'utf-8');
        return temp;
    }

    public toString(): string {
        return this.id();
    }
}