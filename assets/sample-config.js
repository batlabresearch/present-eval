/* 샘플 행사 설정: 링크에 시트 연결(?s=)이 없을 때 보여 주는 테스트 화면용.
 * apps-script/Code.gs의 sampleTabs_()를 같은 규칙(buildConfig_)으로 바꾼 결과입니다. 직접 고치지 말고
 * sampleTabs_()를 고친 뒤 node tools/build-sample.js를 실행하세요. */
window.EVAL_SAMPLE = {
  "eventId": "sample",
  "eventTitle": "2026 OO 학술대회",
  "hero": {
    "org": "OO대학교 OO학과",
    "orgEn": "Department of Sample Studies",
    "display": "2026",
    "displaySub": "ACADEMIC FESTIVAL"
  },
  "grades": [
    "A",
    "B",
    "C",
    "D",
    "E"
  ],
  "commentLabel": "심사의견",
  "advisorLabel": "지도교수",
  "types": [
    {
      "label": "구두발표",
      "criteria": [
        {
          "label": "연구내용의 창의성 및 우수성",
          "max": 30,
          "points": {
            "A": 30,
            "B": 27,
            "C": 24,
            "D": 21,
            "E": 18
          }
        },
        {
          "label": "구연능력",
          "max": 30,
          "points": {
            "A": 30,
            "B": 27,
            "C": 24,
            "D": 21,
            "E": 18
          }
        },
        {
          "label": "주제 선정의 명확성",
          "max": 20,
          "points": {
            "A": 20,
            "B": 18,
            "C": 16,
            "D": 14,
            "E": 12
          }
        },
        {
          "label": "발표자료",
          "max": 10,
          "points": {
            "A": 10,
            "B": 9,
            "C": 8,
            "D": 7,
            "E": 6
          }
        },
        {
          "label": "질의 응답",
          "max": 10,
          "points": {
            "A": 10,
            "B": 9,
            "C": 8,
            "D": 7,
            "E": 6
          }
        }
      ],
      "categories": [
        {
          "label": "신진연구자 부문",
          "presenters": [
            {
              "name": "김하늘",
              "topic": "딥러닝을 이용한 흉부 X선 영상의 이상 소견 검출",
              "advisor": "박지훈",
              "time": "13:00 - 13:15"
            },
            {
              "name": "이도윤",
              "topic": "웨어러블 센서 기반 보행 패턴 분석\nGait Pattern Analysis Using Wearable Sensors",
              "advisor": "최서연",
              "time": "13:15 - 13:30"
            },
            {
              "name": "박서준",
              "topic": "전자의무기록을 이용한 입원 기간 예측 모델",
              "advisor": "정우성",
              "time": "13:30 - 13:45"
            }
          ]
        },
        {
          "label": "우수연구 부문",
          "presenters": [
            {
              "name": "최지우",
              "topic": "하이드로겔 마이크로니들을 이용한 국소 약물 전달",
              "advisor": "한예슬",
              "time": "14:00 - 14:20"
            },
            {
              "name": "정민서",
              "topic": "대규모 언어모델을 활용한 임상 기록 요약",
              "advisor": "박지훈",
              "time": "14:20 - 14:40"
            }
          ]
        }
      ]
    },
    {
      "label": "포스터발표",
      "criteria": [
        {
          "label": "구성",
          "max": 20,
          "points": {
            "A": 20,
            "B": 18,
            "C": 16,
            "D": 14,
            "E": 12
          }
        },
        {
          "label": "내용",
          "max": 45,
          "points": {
            "A": 45,
            "B": 40.5,
            "C": 36,
            "D": 31.5,
            "E": 27
          }
        },
        {
          "label": "포스터 완성도",
          "max": 20,
          "points": {
            "A": 20,
            "B": 18,
            "C": 16,
            "D": 14,
            "E": 12
          }
        },
        {
          "label": "질의응답",
          "max": 15,
          "points": {
            "A": 15,
            "B": 13.5,
            "C": 12,
            "D": 10.5,
            "E": 9
          }
        }
      ],
      "categories": [
        {
          "label": "포스터 세션",
          "presenters": [
            {
              "name": "한예린",
              "topic": "심전도 신호의 자기지도 사전학습",
              "advisor": "정우성",
              "time": ""
            },
            {
              "name": "오승현",
              "topic": "공간 단백체 분석으로 본 신장 손상 모델",
              "advisor": "한예슬",
              "time": ""
            },
            {
              "name": "강다은",
              "topic": "증강현실 기반 수술 내비게이션의 정확도 평가",
              "advisor": "최서연",
              "time": ""
            },
            {
              "name": "윤시우",
              "topic": "안저 영상을 이용한 당뇨병 발생 예측",
              "advisor": "박지훈",
              "time": ""
            },
            {
              "name": "장하린",
              "topic": "피부 부착형 바이오센서의 장기 안정성",
              "advisor": "정우성",
              "time": ""
            },
            {
              "name": "임준호",
              "topic": "자연어 질의를 SQL로 바꾸는 임상 데이터 검색 도구",
              "advisor": "한예슬",
              "time": ""
            }
          ],
          "time": "11:00 - 12:00"
        }
      ]
    }
  ]
};
