import { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  DateTime: { input: Date; output: Date; }
  JSON: { input: any; output: any; }
};

export type Chat = {
  __typename?: 'Chat';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  messages: Array<Message>;
  name: Scalars['String']['output'];
};

export type Message = {
  __typename?: 'Message';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  imageUrls: Array<Scalars['String']['output']>;
  role: Role;
  text?: Maybe<Scalars['String']['output']>;
  toolArgs?: Maybe<Array<ToolArg>>;
  toolCalls: Array<ToolCall>;
  widgetInteraction?: Maybe<WidgetInteraction>;
};

export type Mutation = {
  __typename?: 'Mutation';
  createChat: Chat;
  deleteChat: Chat;
  sendMessage: Message;
  updateTitle: Chat;
  widgetInteraction: WidgetInteraction;
};


export type MutationCreateChatArgs = {
  name: Scalars['String']['input'];
};


export type MutationDeleteChatArgs = {
  chatId: Scalars['ID']['input'];
};


export type MutationSendMessageArgs = {
  chatId: Scalars['ID']['input'];
  text: Scalars['String']['input'];
};


export type MutationUpdateTitleArgs = {
  chatId: Scalars['ID']['input'];
  title: Scalars['String']['input'];
};


export type MutationWidgetInteractionArgs = {
  interaction: WidgetInteractionInput;
};

export type Query = {
  __typename?: 'Query';
  getChat: Chat;
  getChats: Array<Chat>;
};


export type QueryGetChatArgs = {
  id: Scalars['ID']['input'];
};


export type QueryGetChatsArgs = {
  first?: Scalars['Int']['input'];
  offset?: Scalars['Int']['input'];
};

export enum Role {
  Assistant = 'ASSISTANT',
  User = 'USER'
}

export type Subscription = {
  __typename?: 'Subscription';
  messageAdded: Message;
};


export type SubscriptionMessageAddedArgs = {
  chatId: Scalars['ID']['input'];
};

export type ToolArg = {
  __typename?: 'ToolArg';
  arguments: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type ToolCall = {
  __typename?: 'ToolCall';
  id: Scalars['String']['output'];
  isCompleted: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
};

export type WidgetInteraction = {
  __typename?: 'WidgetInteraction';
  answer?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  options?: Maybe<Array<Maybe<Scalars['String']['output']>>>;
  widgetId: Scalars['String']['output'];
};

export type WidgetInteractionInput = {
  interaction: Scalars['JSON']['input'];
  messageId: Scalars['String']['input'];
  widgetId: Scalars['String']['input'];
};

export type WithIndex<TObject> = TObject & Record<string, any>;
export type ResolversObject<TObject> = WithIndex<TObject>;

export type ResolverTypeWrapper<T> = Promise<T> | T;

export type Resolver<TResult, TParent = {}, TContext = {}, TArgs = {}> = ResolverFn<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = {}, TContext = {}, TArgs = {}> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = {}, TContext = {}> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = {}, TContext = {}> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = {}, TParent = {}, TContext = {}, TArgs = {}> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;



/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = ResolversObject<{
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  Chat: ResolverTypeWrapper<Chat>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  JSON: ResolverTypeWrapper<Scalars['JSON']['output']>;
  Message: ResolverTypeWrapper<Message>;
  Mutation: ResolverTypeWrapper<{}>;
  Query: ResolverTypeWrapper<{}>;
  Role: Role;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  Subscription: ResolverTypeWrapper<{}>;
  ToolArg: ResolverTypeWrapper<ToolArg>;
  ToolCall: ResolverTypeWrapper<ToolCall>;
  WidgetInteraction: ResolverTypeWrapper<WidgetInteraction>;
  WidgetInteractionInput: WidgetInteractionInput;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  Boolean: Scalars['Boolean']['output'];
  Chat: Chat;
  DateTime: Scalars['DateTime']['output'];
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  JSON: Scalars['JSON']['output'];
  Message: Message;
  Mutation: {};
  Query: {};
  String: Scalars['String']['output'];
  Subscription: {};
  ToolArg: ToolArg;
  ToolCall: ToolCall;
  WidgetInteraction: WidgetInteraction;
  WidgetInteractionInput: WidgetInteractionInput;
}>;

export type IsAuthorizedDirectiveArgs = { };

export type IsAuthorizedDirectiveResolver<Result, Parent, ContextType = any, Args = IsAuthorizedDirectiveArgs> = DirectiveResolverFn<Result, Parent, ContextType, Args>;

export type ChatResolvers<ContextType = any, ParentType extends ResolversParentTypes['Chat'] = ResolversParentTypes['Chat']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  messages?: Resolver<Array<ResolversTypes['Message']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export interface JsonScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['JSON'], any> {
  name: 'JSON';
}

export type MessageResolvers<ContextType = any, ParentType extends ResolversParentTypes['Message'] = ResolversParentTypes['Message']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  imageUrls?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  role?: Resolver<ResolversTypes['Role'], ParentType, ContextType>;
  text?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  toolArgs?: Resolver<Maybe<Array<ResolversTypes['ToolArg']>>, ParentType, ContextType>;
  toolCalls?: Resolver<Array<ResolversTypes['ToolCall']>, ParentType, ContextType>;
  widgetInteraction?: Resolver<Maybe<ResolversTypes['WidgetInteraction']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = any, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  createChat?: Resolver<ResolversTypes['Chat'], ParentType, ContextType, RequireFields<MutationCreateChatArgs, 'name'>>;
  deleteChat?: Resolver<ResolversTypes['Chat'], ParentType, ContextType, RequireFields<MutationDeleteChatArgs, 'chatId'>>;
  sendMessage?: Resolver<ResolversTypes['Message'], ParentType, ContextType, RequireFields<MutationSendMessageArgs, 'chatId' | 'text'>>;
  updateTitle?: Resolver<ResolversTypes['Chat'], ParentType, ContextType, RequireFields<MutationUpdateTitleArgs, 'chatId' | 'title'>>;
  widgetInteraction?: Resolver<ResolversTypes['WidgetInteraction'], ParentType, ContextType, RequireFields<MutationWidgetInteractionArgs, 'interaction'>>;
}>;

export type QueryResolvers<ContextType = any, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  getChat?: Resolver<ResolversTypes['Chat'], ParentType, ContextType, RequireFields<QueryGetChatArgs, 'id'>>;
  getChats?: Resolver<Array<ResolversTypes['Chat']>, ParentType, ContextType, RequireFields<QueryGetChatsArgs, 'first' | 'offset'>>;
}>;

export type SubscriptionResolvers<ContextType = any, ParentType extends ResolversParentTypes['Subscription'] = ResolversParentTypes['Subscription']> = ResolversObject<{
  messageAdded?: SubscriptionResolver<ResolversTypes['Message'], "messageAdded", ParentType, ContextType, RequireFields<SubscriptionMessageAddedArgs, 'chatId'>>;
}>;

export type ToolArgResolvers<ContextType = any, ParentType extends ResolversParentTypes['ToolArg'] = ResolversParentTypes['ToolArg']> = ResolversObject<{
  arguments?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type ToolCallResolvers<ContextType = any, ParentType extends ResolversParentTypes['ToolCall'] = ResolversParentTypes['ToolCall']> = ResolversObject<{
  id?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  isCompleted?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type WidgetInteractionResolvers<ContextType = any, ParentType extends ResolversParentTypes['WidgetInteraction'] = ResolversParentTypes['WidgetInteraction']> = ResolversObject<{
  answer?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  options?: Resolver<Maybe<Array<Maybe<ResolversTypes['String']>>>, ParentType, ContextType>;
  widgetId?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
}>;

export type Resolvers<ContextType = any> = ResolversObject<{
  Chat?: ChatResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  JSON?: GraphQLScalarType;
  Message?: MessageResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  Subscription?: SubscriptionResolvers<ContextType>;
  ToolArg?: ToolArgResolvers<ContextType>;
  ToolCall?: ToolCallResolvers<ContextType>;
  WidgetInteraction?: WidgetInteractionResolvers<ContextType>;
}>;

export type DirectiveResolvers<ContextType = any> = ResolversObject<{
  isAuthorized?: IsAuthorizedDirectiveResolver<any, any, ContextType>;
}>;
