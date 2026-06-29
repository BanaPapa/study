// Convex 함수는 런타임에 환경변수(process.env)에 접근할 수 있다.
// 하지만 convex/tsconfig.json 에는 node 타입이 없어 `process` 가 타입체크에서
// "Cannot find name 'process'"(TS2580) 로 깨진다. @types/node 전체를 끌어오는 대신
// 필요한 최소 범위만 ambient 로 선언해 convex deploy 의 타입체크를 통과시킨다.
declare const process: {
  env: Record<string, string | undefined>;
};
