import { Resolvers } from "../generated/graphql"
import { messageEventService } from "../services/MessageEventService"
import { GraphQLJSON } from "graphql-type-json"

export const resolvers: Resolvers = {
  JSON: GraphQLJSON,
  Query: {
    getChats: (_, { first, offset }, { chatService, userId }) =>
      chatService.getChats(first, offset, userId),
    getChat: (_, { id }, { chatService }) => chatService.getChat(id),
  },

  Mutation: {
    createChat: (_, { name }, { chatService, userId }) =>
      chatService.createChat(name, userId),
    sendMessage: (_, { chatId, text }, { chatService, userId }) =>
      chatService.sendMessage(chatId, text, userId),
    updateTitle: (_, { chatId, title }, { chatService }) =>
      chatService.updateChatTitle(chatId, title),
    deleteChat: (_, { chatId }, { chatService }) =>
      chatService.deleteChat(chatId),
    widgetInteraction: (_, { interaction }, { chatService }) =>
      chatService.addWidgetInteraction(interaction),
  },

  Subscription: {
    messageAdded: {
      subscribe: (_, { chatId }, { storage }) => ({
        [Symbol.asyncIterator]: () => {
          const subscription = messageEventService.createSubscription(
            chatId,
            storage
          )

          return {
            next: () => subscription.next(),
            return: () => {
              subscription.cleanup()
              return Promise.resolve({ value: undefined, done: true })
            },
            throw: (error) => {
              subscription.cleanup()
              return Promise.reject(error)
            },
          }
        },
      }),
    },
  },
}
