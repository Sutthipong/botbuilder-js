/**
 * @module botbuilder-dialogs-adaptive
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { Dialog, TurnPath } from 'botbuilder-dialogs';
import { ExpressionParserInterface, Expression, ExpressionType } from 'adaptive-expressions';
import { OnCondition } from './onCondition';

/**
 * Actions triggered when a custom dialog event is emitted.
 */
export class OnCustomEvent extends OnCondition {
    /**
     * Gets or sets the custom event to fire on.
     */
    public event: string;

    public constructor(event?: string, actions: Dialog[] = [], condition?: string) {
        super(condition, actions);
        this.event = event;
    }

    public getExpression(parser: ExpressionParserInterface): Expression {
        const expression = parser.parse(`${ TurnPath.dialogEvent }.name == '${ this.event }'`);
        return Expression.makeExpression(ExpressionType.And, undefined, expression, super.getExpression(parser));
    }
}