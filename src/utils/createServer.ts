import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import { User } from "@prisma/client";
import { ApolloServerPluginDrainHttpServer } from "apollo-server-core";
import { ApolloServer } from "apollo-server-fastify";
import { ApolloServerPlugin } from "apollo-server-plugin-base";
import fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { GraphQLSchema, execute, subscribe } from "graphql";
import { SubscriptionServer } from "subscriptions-transport-ws";
import { buildSchema } from "type-graphql";
import MessageResolver from "../modules/message/message.resolver";
import UserResolver from "../modules/user/user.resolver";
import { bearerAuthChecker } from "./bearerAuthChecker";

const app = fastify({
  logger: false,
});

app.register(fastifyCors, {
  credentials: true,
  origin: (origin, cb) => {
    if (
      !origin ||
      ["http://localhost:3000", "https://studio.apollographql.com"].includes(
        origin
      )
    ) {
      return cb(null, true);
    }
    return cb(new Error("Now allowed"), false);
  },
});

app.register(fastifyCookie, {
  parseOptions: {},
});

app.register(fastifyJwt, {
  secret: "change-me",
  cookie: {
    cookieName: "token",
    signed: false,
  },
});

function fastifyAppClosePlugin(app: FastifyInstance): ApolloServerPlugin {
  return {
    async serverWillStart() {
      console.log("SERVER WILL START");
      return {
        async drainServer() {
          console.log("DRAIN SERVER");
          await app.close();
        },
      };
    },
  };
}

type CtxUser = Omit<User, "password">;

async function buildContext({
  request,
  reply,
  connectionParams,
}: {
  request: FastifyRequest;
  reply: FastifyReply;
  connectionParams?: {
    Authorization: string;
  };
}) {
  if (connectionParams || !request) {
    try {
      return {
        user: await app.jwt.verify<CtxUser>(
          connectionParams?.Authorization || ""
        ),
      };
    } catch (e) {
      return { user: null };
    }
  }

  try {
    const user = await request.jwtVerify<CtxUser>();
    return { request, reply, user };
  } catch (e) {
    return { request, reply, user: null };
  }
}

export type Context = Awaited<ReturnType<typeof buildContext>>;

export async function createServer() {
  const schema = await buildSchema({
    resolvers: [UserResolver, MessageResolver],
    authChecker: bearerAuthChecker,
  });

  const server = new ApolloServer({
    schema,
    plugins: [
      fastifyAppClosePlugin(app),
      ApolloServerPluginDrainHttpServer({ httpServer: app.server }),
    ],
    context: buildContext,
  });

  subscriptionServer({ schema, server: app.server });

  return { app, server };
}

const subscriptionServer = ({
  schema,
  server,
}: {
  schema: GraphQLSchema;
  server: typeof app.server;
}) => {
  return SubscriptionServer.create(
    {
      schema,
      execute,
      subscribe,
      async onConnect(connectionParams: Object) {
        return buildContext({ connectionParams });
      },
    },
    {
      server,
      path: "/graphql",
    }
  );
};
