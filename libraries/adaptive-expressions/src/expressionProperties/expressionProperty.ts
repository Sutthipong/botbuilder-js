/**
 * @module adaptive-expressions
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { Expression } from '../expression';


/**
 * Base class which defines a Expression or value for a property.
 */
export class ExpressionProperty<T> {
    private defaultValue: T;

    public constructor(value?: T | string | Expression, defaultValue?: T) {
        this.defaultValue = defaultValue;
        this.setValue(value);
    }

    public value: T;

    public expression: Expression;

    public toString(): string {
        return this.expression ? `=${ this.expression.toString() }` : (this.value ? this.value.toString() : '');
    }

    public toExpression(): Expression {
        if (this.expression) {
            return this.expression;
        }

        // Generate expression
        switch (typeof this.value) {
            case 'string':
            case 'number':
            case 'boolean':
                return Expression.parse(this.value.toString());
            default:
                if (this.value == undefined || this.value == null) {
                    return Expression.parse('null');
                } else {
                    return Expression.parse(`json(${ JSON.stringify(this.value) })`);
                }
        }
    }

    /**
     * Get the value.
     * @remarks
     * An error will be thrown if value is an invalid expression.
     * @param data Data to use for expression binding.
     * @returns the value.
     */
    public getValue(data: object): T {
        const { value, error } = this.tryGetValue(data);
        if (error) { throw error; }

        return value;
    }

    /**
     * Try to Get the value.
     * @param data Data to use for expression binding.
     * @returns the value or an error.
     */
    public tryGetValue(data: object): { value: T; error: Error } {
        if (this.expression) {
            return this.expression.tryEvaluate(data) as any;
        }

        return { value: this.value, error: undefined };
    }

    public setValue(value: T | string | Expression): void {
        this.value = this.defaultValue;
        this.expression = undefined;

        if (typeof value == 'string') {
            if (value.startsWith('=')) { value = value.substr(1); }
            this.expression = Expression.parse(value);
        } else if (value instanceof Expression) {
            this.expression = value;
        } else if (value !== undefined) {
            this.value = value;
        }
    }
}

