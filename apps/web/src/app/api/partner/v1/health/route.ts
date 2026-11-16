import { NextResponse } from 'next/server'
export async function GET(){return NextResponse.json({status:'ok',service:'alizo-partner-api',version:'v1',time:new Date().toISOString()})}
