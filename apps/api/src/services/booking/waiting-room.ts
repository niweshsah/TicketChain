import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/errors';
import { redis } from '../../shared/infrastructure/redis';

export const updateRoom = `
local prefix, user, now, operation, token = ARGV[1], ARGV[2], tonumber(ARGV[3]), ARGV[4], ARGV[5]
local queue, heartbeat, active, passes = prefix..':queue', prefix..':heartbeat', prefix..':active', prefix..':passes'
for _, member in ipairs(redis.call('ZRANGEBYSCORE', heartbeat, '-inf', now-45000)) do
  redis.call('ZREM',queue,member); redis.call('ZREM',heartbeat,member)
end
for _, member in ipairs(redis.call('ZRANGEBYSCORE', active, '-inf', now)) do
  redis.call('ZREM',active,member); redis.call('HDEL',passes,member)
end
if operation=='leave' then
  redis.call('ZREM',queue,user); redis.call('ZREM',heartbeat,user); redis.call('ZREM',active,user); redis.call('HDEL',passes,user)
  return cjson.encode({state='left',position=0})
end
if operation=='join' and not redis.call('ZSCORE',queue,user) and not redis.call('ZSCORE',active,user) then
  redis.call('ZADD',queue,redis.call('INCR',prefix..':sequence'),user)
end
if redis.call('ZSCORE',queue,user) then redis.call('ZADD',heartbeat,now,user) end
local rateKey = prefix..':rate:'..math.floor(now/1000)
local admitted = tonumber(redis.call('GET',rateKey) or '0')
local capacity = math.min(10-admitted,50-redis.call('ZCARD',active))
for i=1,capacity do
  local nextUser = redis.call('ZRANGE',queue,0,0)[1]
  if not nextUser then break end
  redis.call('ZREM',queue,nextUser); redis.call('ZREM',heartbeat,nextUser)
  redis.call('ZADD',active,now+120000,nextUser)
  redis.call('HSET',passes,nextUser,token..':'..nextUser)
  redis.call('INCR',rateKey); redis.call('PEXPIRE',rateKey,2000)
end
for _, key in ipairs({queue,heartbeat,active,passes,prefix..':sequence'}) do redis.call('PEXPIRE',key,1800000) end
local expiry = redis.call('ZSCORE',active,user)
if expiry then return cjson.encode({state='admitted',position=0,pass=redis.call('HGET',passes,user),expiresAt=tonumber(expiry)}) end
local position = redis.call('ZRANK',queue,user)
return cjson.encode({state=position and 'waiting' or 'not_joined',position=position and position+1 or 0})
`;

export interface WaitingRoomStatus {
  state: 'disabled' | 'not_joined' | 'waiting' | 'admitted' | 'left';
  position: number;
  pass?: string;
  expiresAt?: number;
}

export async function waitingRoom(
  eventId: string,
  userId: string,
  operation: 'join' | 'status' | 'leave',
): Promise<WaitingRoomStatus> {
  const client = await redis();
  const result = await client.eval(updateRoom, {
    keys: [],
    arguments: [
      `room:${eventId}`,
      userId,
      String(Date.now()),
      operation,
      randomUUID(),
    ],
  });
  return JSON.parse(String(result)) as WaitingRoomStatus;
}

export async function consumePass(
  eventId: string,
  userId: string,
  pass: string | undefined,
  key: string,
) {
  if (!pass)
    throw new AppError(
      409,
      'WAITING_ROOM_REQUIRED',
      'Join the waiting room before reserving tickets.',
    );
  const client = await redis();
  const accepted = await client.eval(
    `
    local prefix,user,pass,key,now=ARGV[1],ARGV[2],ARGV[3],ARGV[4],tonumber(ARGV[5])
    local used=redis.call('GET',prefix..':used:'..user..':'..pass)
    if used then return used==key and 1 or 0 end
    local expiry=tonumber(redis.call('ZSCORE',prefix..':active',user) or '0')
    if expiry<=now or redis.call('HGET',prefix..':passes',user)~=pass then return 0 end
    redis.call('SET',prefix..':used:'..user..':'..pass,key,'PX',120000)
    redis.call('ZREM',prefix..':active',user); redis.call('HDEL',prefix..':passes',user)
    return 1`,
    {
      keys: [],
      arguments: [`room:${eventId}`, userId, pass, key, String(Date.now())],
    },
  );
  if (Number(accepted) !== 1)
    throw new AppError(
      409,
      'ADMISSION_PASS_EXPIRED',
      'Your waiting-room pass expired or was used. Rejoin to try again.',
    );
}
